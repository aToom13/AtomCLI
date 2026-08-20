# AtomCLI İyileştirme Yol Haritası

Bu belge, AtomCLI ile DeepSeek Harness (DSH) kaynak/mimari incelemesinden çıkan geliştirme önerilerini toplar. Amaç DSH'yi kopyalamak değildir: AtomCLI'nin terminal-first ürün ergonomisini, hazır coding akışlarını ve güçlü permission/review deneyimini korurken runtime sınırlarını, güvenliği ve sürdürülebilirliği güçlendirmektir.

## Kısa karar

AtomCLI bugün terminal-first coding agent ürünü olarak güçlüdür: TUI, MCP/skills, model seçimi ve routing, reviewer/checker akışı, LSP ve structured DAG orchestration birlikte çalışır. DSH ise process confinement, append-only session modeli, provider seam'leri ve Web UI/test kapsamı bakımından daha sistematik bir agent runtime'tır.

Bu nedenle hedef mimari şudur:

```text
TUI / SDK / ACP / Companion
             │
        Agent Runtime
             │
  Roles ─ Orchestrator ─ Session Engine
             │
         Tool Runtime
             │
 permission → execution policy → sandbox → tool result
             │
 Shell / FS / PTY / LSP / Web / Subagent providers
```

En önemli sıralama değişikliği: geniş bir ToolRuntime refactor'ından **önce**, ağdan erişilebilen kontrol düzlemi ve process environment için dar kapsamlı güvenlik düzeltmeleri çıkmalıdır.

## Mevcut güçlü taraflar korunmalı

- Terminal-first TUI ve model picker deneyimi.
- `PermissionNext` içindeki `allow` / `deny` / `ask`, agent bazlı hard-deny ve YOLO modunda dahi korunan sınırlar.
- Reviewer, checker ve ReviewGate ile bağımsız QA akışı.
- Plan, dependency graph, paralel katmanlar, retry ve model routing içeren structured DAG orchestration.
- Tool şeması doğrulama ve output truncation yaklaşımı.
- MCP, skills, provider ve SDK ürün yüzeyi.
- Webfetch tarafındaki SSRF önlemleri ve proje kökü içindeki path traversal korumaları.

DSH'den alınacak fikirler bunları değiştirmemeli; bu özellikleri daha güvenli ve ortak primitive'ler üstüne yerleştirmelidir.

## P0 — Kontrol düzlemi güvenliği

### Sorun

AtomCLI varsayılan olarak loopback üzerinde çalışsa da companion modu veya eşleşmiş cihaz durumu genel sunucuyu `0.0.0.0` üzerinde dinlemeye taşıyabilmektedir. Bu durumda yalnızca companion kanalı değil, genel HTTP API yüzeyi de LAN'a açılır. CORS browser politikasidir; curl, mobil istemci veya yerel ağdaki başka bir uygulama için authentication değildir.

İncelenen akışta ayrıca şu riskler vardır:

- Genel HTTP API için merkezi bir authentication middleware'i yoktur.
- İstemci `directory` alanıyla proje kökünü seçebilmektedir; file servisi bu köke göre sınırlandırsa da güvenilmeyen çağıran `/` seçebiliyorsa sınır etkisizleşir.
- PTY endpoint'i komut, argüman, `cwd` ve environment alarak doğrudan process başlatır; bu yol PermissionNext ve olası Bash sandbox'ını bypass eder.
- Companion WebSocket bağlantısı kimlik doğrulanmadan snapshot bilgisi gönderebilir.
- Companion mutasyonları imzalı olsa da mesajlarda nonce/counter/timestamp olmaması, açık taşıma üzerinden yakalanan geçerli mesajların replay edilmesi riskini doğurabilir.

İlgili kod: [network.ts](AtomBase/src/interfaces/cli/network.ts), [server.ts](AtomBase/src/server/server.ts), [PTY route](AtomBase/src/server/routes/pty.ts), [PTY runtime](AtomBase/src/interfaces/pty/index.ts), [companion.ts](AtomBase/src/server/companion.ts).

### Karar

Genel API ve companion API tek bir güven sınırı olarak ele alınmamalıdır.

```text
Loopback control plane                    LAN companion plane
─────────────────────                    ──────────────────
sessions, files, PTY, config,             companion-only RPC
credentials, MCP, admin APIs              authenticated handshake
local SDK/ACP                             scoped read access
                                           signed messages + replay defense
```

### Uygulama

1. Ana control plane'i varsayılan olarak yalnızca `127.0.0.1` / `::1` üzerinde tutun.
2. Non-loopback bind istenirse açık bir `--auth` yapılandırması olmadan fail-closed hata verin.
3. LAN companion için ayrı router/listener kullanın; generic file, PTY, config, credential ve session-admin endpoint'lerini burada register etmeyin.
4. HTTP için bearer veya capability token ekleyin. Token'ları query string'e koymayın.
5. WebSocket için ilk mesajda challenge-response doğrulaması yapın; doğrulanmadan snapshot veya session listesi göndermeyin.
6. İmzalı companion mesajlarına session-bound monotonic counter veya nonce + kısa geçerlilik süresi ekleyin; daha önce görülen counter/nonce'ları reddedin.
7. Host header doğrulaması ve Origin/Host eşlemesi ekleyerek DNS rebinding riskini azaltın.
8. LAN taşıması için WSS, mTLS veya Tailscale benzeri güvenli overlay seçeneği sunun.
9. Wildcard cloud proxy korunacaksa, local authorization ve cookie başlıklarını upstream'e asla iletmeyin.

### Kabul kriterleri

- Auth yokken `0.0.0.0` bind reddedilir.
- Yetkisiz HTTP istemcisi PTY, file, credentials, session veya config endpoint'lerine erişemez.
- Yetkisiz WebSocket istemcisi snapshot alamaz.
- Yanlış Host/Origin ile gelen browser isteği reddedilir.
- Aynı signed companion mesajı ikinci kez gönderildiğinde reddedilir.
- Bu davranışlar HTTP ve WebSocket integration testleriyle güvence altındadır.

## P0 — Environment isolation ve PTY'nin ortak politikaya alınması

### Sorun

Bash tool'u child process başlatırken `process.env`'i miras alır. Böylece AtomCLI'yi başlatan kullanıcıdaki provider API key'leri, AWS/GitHub credential'ları veya başka sırlar modelin çalıştırdığı subprocess tarafından görülebilir. PTY de benzer biçimde environment devralır.

`.env` dosyasını permission ile engellemek yeterli değildir; sırlar dosyada değil process environment'ta olabilir.

İlgili kod: [bash.ts](AtomBase/src/integrations/tool/bash.ts), [PTY runtime](AtomBase/src/interfaces/pty/index.ts).

### Uygulama

`EnvPolicy` oluşturun ve tüm subprocess açılışlarında zorunlu yapın:

```ts
type EnvMode = "minimal" | "filtered" | "inherit"

interface EnvPolicy {
  mode: EnvMode
  allow?: string[]
  grants?: Array<{ name: string; scope: string; expiresAt?: number }>
}
```

- Varsayılan `minimal`: `PATH`, `HOME`, `USER`, `SHELL`, `LANG`, `TERM`, `TMPDIR`, `PWD` gibi güvenli değerler.
- `filtered`: açık allowlist ile sınırlı ek değerler.
- `inherit`: yalnızca kullanıcı tarafından açıkça onaylanan development/compatibility senaryolarında.
- Secret'lar `process.env`'den otomatik taşınmaz; tool/agent scope'lu geçici grant ile verilir.
- Bash, PTY, LSP, formatter, browser yardımcı process'leri ve plugin subprocess'leri aynı builder'ı kullanır.

### Kabul kriterleri

- Varsayılan Bash/PTY child process'inde `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `AWS_SECRET_ACCESS_KEY`, `GITHUB_TOKEN` görünmez.
- Açık grant verilen bir secret yalnızca ilgili tool çağrısında görünür.
- PTY, Bash ile aynı environment ve permission politikasını kullanır.

## P1 — Merkezi ToolRuntime

### Sorun

AtomCLI'de `tool.execute.before` / `tool.execute.after` hook'ları bulunmaktadır; yani altyapı sıfırdan kurulmayacaktır. Ancak permission, timeout, telemetry, output normalize etme, process ownership ve farklı execution yolları tek yerde toplanmamıştır. Native tool, MCP, task, PTY ve batch yollarının aynı güvenlik politikalarından geçtiği garanti değildir.

Ayrıca mevcut `before` hook çağrısında dönen wrapper kullanılmadığı için `output.args = replacement` gibi tam replacement davranışı güvenilir değildir; yalnızca nested mutasyonlar etkili olabilir.

İlgili kod: [plugin hooks](libs/plugin/src/index.ts), [tool çağrısı](AtomBase/src/core/session/prompt.ts).

### Hedef pipeline

```text
resolve tool + schema validation
        ↓
durable request envelope
        ↓
preflight hooks
        ↓
permission / approval
        ↓
execution policy + env policy
        ↓
sandbox provider
        ↓
timeout / cancellation / process ownership
        ↓
tool implementation
        ↓
redaction / normalize / truncate
        ↓
durable result
        ↓
post hooks + telemetry
```

### Uygulama

1. `ToolRuntime.execute(call, context)` ile tek giriş noktası oluşturun.
2. Mevcut `Tool.define()` şema doğrulama ve truncation davranışını koruyun.
3. `ToolMiddleware` için `before`, `around`, `after` semantiği ekleyin; replacement değerlerini açıkça geri döndürün.
4. Permission, sandbox, timeout, retry, redaction ve telemetry middleware olmalıdır.
5. PTY ve MCP dahil tüm execution yollarını aşamalı olarak bu runtime'a taşıyın.
6. Tool result için canonical internal shape belirleyin; UI/CLI/SDK renderer'ları bu sonuçtan türesin.

### Neden önce değil?

Bu refactor doğru mimari omurgadır; ancak mevcut ağ erişimi ve ambient-secret sorunları daha dar bir değişiklikle hemen kapatılabilir. P0 güvenlik yamaları ToolRuntime tamamlanmasını beklememelidir.

## P1 — ExecutionWorld ve OS sandbox

### Sorun

Permission kullanıcı niyetini ve UX'i yönetir; gerçek OS enforcement değildir. Reviewer command denylist'leri defense-in-depth olarak faydalıdır, fakat `node`, `git`, `ssh`, `perl`, `busybox` gibi alternatifler yüzünden güvenlik sınırı olamaz.

### Hedef sözleşme

```ts
interface ExecutionPolicy {
  filesystem: "read-only" | "workspace-write" | "full"
  network: "deny" | "allow"
  environment: "minimal" | "filtered" | "inherit"
  processVisibility: "restricted" | "inherit"
  workspaceRoot: string
}

interface ExecutionProvider {
  prepare(command: Command, policy: ExecutionPolicy): Promise<PreparedCommand>
}
```

### Uygulama sırası

1. Linux: Bubblewrap birincil backend, Landlock uygun fallback/ek enforcement.
2. Sandbox istenip backend kullanılamıyorsa host üzerinde sessizce çalıştırmak yerine fail-closed davranın.
3. Enforcement seviyesini `full` / `partial` / `off` olarak tool sonucunda ve UI'da raporlayın.
4. macOS Seatbelt backend'i ekleyin.
5. Windows backend'ini ayrı fazda restricted token/ACL ile ekleyin.
6. Filesystem yanında network, environment ve process visibility politikasını API'ye dahil edin. DSH'nin filesystem-only sınırını devralmayın.

### Önemli sınır

Worker thread veya `node:vm` bir security sandbox değildir. Sandbox gerçek process/OS sınırında uygulanmalıdır.

## P1 — Session replay ve durable request envelope

### Sorun

Session verisi ağırlıkla mutable message/part snapshot'larından oluşur. Oysa modelin gerçekten gördüğü request; system prompt, tool schema'ları, plugin transform'ları, model route, compaction summary ve enjekte edilmiş context ile oluşur. Bug anında “model bunu neden söyledi?” sorusu eksiksiz yanıtlanamaz.

### İlke

> Modelin gördüğü her bilgi log'dan yeniden oluşturulabilmelidir.

### Uygulama

Tam event-sourcing rewrite ile başlamayın. Önce her LLM çağrısı öncesinde immutable request envelope kaydedin:

```text
requestId, sessionId, timestamp
system prompt hash + content
rendered messages
tool definitions
selected provider/model/route
plugin transforms
compaction checkpoint
injected context
```

Sonraki aşamada tool call/result, compaction ve workflow state event'lerini append-only hale getirin. Geliştirme/test modunda şu invariant'ı çalıştırın:

```ts
assert.deepEqual(session.renderModelInput(requestId), actualModelInput)
```

Bu yaklaşım replay, regression debugging, cost analizi ve kullanıcıya açıklanabilirlik sağlar.

## P1 — Subagent role ile runtime'ı ayırma

### Sorun

Mevcut subagent sistemi güçlü rol/permission tanımlarına sahip olsa da runtime büyük ölçüde yerel AtomCLI session çalıştırmasına bağlıdır. Rol ile çalıştırma backend'i ayrılmazsa ACP veya dış agent entegrasyonları her feature'a sızar.

### Hedef

```text
AgentRole                         AgentRuntimeProvider
─────────                         ────────────────────
reviewer                          atom-inprocess
explore                           atom-process
analyst                           ACP
coding                            remote-atom
                                  future: Codex / Claude Code
```

### Uygulama

1. İlk provider yalnızca mevcut davranışı saran `atom-inprocess` olsun; davranış değiştirmeyin.
2. Provider capability sözleşmesi ekleyin: `outputSchema`, `persona`, `toolFilter`, `depthLimit`, `continuation`, `cancellation`.
3. Desteklenmeyen capability için görev başladıktan sonra sessizce düşmek yerine başlangıçta hata verin.
4. Ownership, cancellation, timeout, result ve dispose sorumluluklarını provider'a bağlayın.
5. ACP ikinci provider olmalıdır. Codex/Claude Code gibi dış runtime'lar ancak seam kanıtlandıktan sonra eklenmelidir.

## P1/P2 — Orchestrator'ı ayırma ve workflow durability

### Sorun

`orchestrate.ts` artık tool adapter olmaktan çıkıp planning, graph validation, scheduling, model routing, execution, retry, status ve result aggregation bilgilerini birlikte taşımaktadır. In-memory map/TTL yaklaşımı daemon restart'ında workflow bilgisini kaybeder.

### Hedef yapı

```text
orchestration/
  graph.ts
  planner.ts
  scheduler.ts
  executor.ts
  workflow-store.ts
  result-aggregator.ts

routing/
  model-router.ts
  policies.ts

tool/
  orchestrate.ts        // model-facing adapter
```

### Uygulama

- Mevcut structured DAG'ı koruyun. Modelin özgür JavaScript yazdığı workflow modeline hemen geçmeyin.
- Plan, task state, dependency result, model seçimi ve checkpoint'leri durable store'a yazın.
- Restart sonrası `running`, `unknown outcome`, `failed`, `resumable` durumlarını açıkça yönetin.
- Workflow API'si plan/status/abort dışında replay ve recovery bilgisini sunmalıdır.
- `orchestrate.ts` içinden routing ve scheduler mantığını bağımsız test edilebilir modüllere çıkarın.

## P2 — Compaction V2

Mevcut compaction mekanizması korunmalı, fakat şu garantiler eklenmelidir:

- Tool-call/tool-result çiftleri ortadan bölünmez.
- Retained tail hedefi ve pressure/overflow trigger'ları ayrı ele alınır.
- Yeni summary, yerine geçtiği context'ten gerçekten daha küçük değilse kabul edilmez; retry edilir.
- `compaction/start`, `summary`, checkpoint replacement ve `compaction/end` durable transaction şeklinde kaydedilir.
- Crash sonrası yarım compaction tespit edilir ve güvenli recovery uygulanır.
- Compression ratio, token kazancı ve retry metrikleri gözlemlenir.

## P2 — Plugin lifecycle ve capability seams

AtomCLI plugin hook'ları yararlıdır; fakat uzun yaşayan daemon/server süreçlerinde registration'ların geri alınabilmesi gerekir.

```ts
interface AtomPlugin {
  setup(ctx: PluginContext): Promise<{ dispose(): Promise<void> }>
}
```

Bu sayede tool/provider/MCP registration, event listener, background process ve UI extension temiz biçimde kaldırılabilir. Her şeyi plugin haline getirmek gerekmez; yalnızca değişken capability sınırları provider/service şeklinde ayrılmalıdır.

Uygun seam örnekleri:

```text
ShellService     → local / sandbox / remote providers
SubagentService  → Atom / ACP / external providers
WebSearchService → built-in / Tavily / Exa providers
```

## P2 — API/SDK sözleşmesi ve UI yatırımı

### API

- Server, SDK ve OpenAPI sürümlerini tek kaynaktan üretin; sürüm drift'ini CI ile engelleyin.
- RPC error'larını structured ve machine-readable yapın.
- Cancellation ve event replay/sequence desteğini ekleyin.
- API kimlik doğrulamasını ekledikten sonra SDK/ACP/companion geçişlerini compatibility testleriyle koruyun.

### UI

AtomCLI'nin TUI yatırımı korunmalı. Özellikle model picker, subagent görünümü, virtual list ve recovery deneyimi ürün avantajıdır. Bununla birlikte TUI için component, integration ve snapshot/visual test kapsamı artırılmalıdır.

Web stratejisinde açık karar alınmalıdır:

1. Terminal-first ürün olun ve companion'ı dar, güvenli yardımcı istemci tutun; veya
2. Yerel açık kaynak Web UI sağlayın.

Belirsiz wildcard cloud proxy ile local Web UI izlenimi vermek uzun vadede güvenlik ve ürün anlatısı açısından iyi değildir.

## Yapılmaması gerekenler

- DSH'nin “everything is a plugin” yaklaşımını bütünüyle kopyalamak.
- Sandbox tamamlanmadan remote execution veya model-written JavaScript workflow eklemek.
- Regex tabanlı secret scrub'ı nihai güvenlik çözümü saymak.
- Reviewer denylist'ini sandbox yerine koymak.
- Worker thread/VM'i OS sandbox sanmak.
- Mevcut structured DAG'ı yalnızca daha esnek göründüğü için dinamik script workflow ile değiştirmek.
- Yeni tool/agent sayısını artırırken ortak runtime primitive'lerini ertelemek.

## Önerilen PR sırası

1. **Control-plane lockdown:** listener ayrımı, auth, Host/Origin kontrolü, companion handshake/replay savunması, PTY/file endpoint testleri.
2. **EnvPolicy + PTY düzeltmesi:** secret allowlist/grant sistemi, PTY'nin Permission ve EnvPolicy kapsamına alınması.
3. **ToolRuntime:** merkezi execution pipeline, doğru hook replacement semantiği, cancellation/timeout/result normalize etme.
4. **ExecutionWorld/SandboxService:** Linux backend ve fail-closed davranış; sonra macOS/Windows.
5. **Request envelope:** model-visible replay, durable tool sonuçları ve debugging invariant testleri.
6. **Subagent runtime seam:** Atom provider, sonra ACP, capability negotiation.
7. **Orchestration extraction/durability:** scheduler/store ayrımı, checkpoint/resume.
8. **Compaction V2, plugin lifecycle, API sürüm kapıları ve UI test kapsamı.**

## Mevcut test borcu

Root test çalıştırmasında iki external-directory testi, tek başına geçtiği halde tüm suite'te başarısız olmuştur. Sebep ürün davranışı değil, global test state sızıntısıdır: subagent permission testi `Flag.ATOMCLI_YOLO` değerini değiştirip geri yüklemez; sonraki testler dış dizin kontrolünü bypass eder.

Bu hemen düzeltilmelidir:

- Testte `afterEach` ile önceki flag değerini geri yükleyin.
- Tercihen global flag yerine test/session scoped bağımlılık kullanın.
- Stateful testlerin paralel/ardışık çalışmada izolasyonunu kontrol eden bir regression testi ekleyin.

İlgili kod: [subagent permission testi](AtomBase/test/tool/subagent-permissions.test.ts), [external directory kontrolü](AtomBase/src/integrations/tool/external-directory.ts).

## Başarı ölçütü

Bu yol haritası tamamlandığında AtomCLI:

- LAN'a yanlışlıkla açık bir local control plane olmaktan çıkar.
- Modelin çalıştırdığı process'lere ambient credential sızdırmaz.
- Permission, sandbox ve denylist'in farklı sorumluluklarını net biçimde ayırır.
- Tüm tool/PTY/MCP execution yollarını aynı güvenlik ve telemetry zincirinden geçirir.
- Modelin gördüğü her request'i yeniden oluşturabilir.
- Yerel ve haricî subagent runtime'larını aynı sözleşme ile yönetebilir.
- Workflow'ları restart sonrasında açıklanabilir ve kurtarılabilir hale getirir.
- Terminal-first ürün avantajını korurken agent platformu olarak daha güvenli büyür.

## Kaynak ilhamı

DSH'den alınması önerilen kavramlar: tool execution pipeline, fail-closed sandbox, full/partial enforcement raporu, provider capability negotiation, append-only model-visible log, compaction transaction'ları ve reversible plugin effects.

DSH'den bilinçli olarak alınmaması gerekenler: tüm çekirdeği plugin'e dönüştürmek, worker-thread'i sandbox saymak, sadece filesystem policy ile yetinmek ve preview hızındaki breaking-change modelini AtomCLI'nin stabil ürün yüzeyine taşımak.
