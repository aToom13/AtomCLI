# 🔪 Code Surgery Workspace - server.ts Refactoring

## Hasta Bilgisi
- **Dosya:** `src/server/server.ts`
- **Satır Sayısı:** 2906
- **Hedef:** < 400 satır
- **Strateji:** Controller-Service-Route pattern

## Tespit Edilen Route Grupları
| Grup      | Endpoint Prefix | Tahmini Satır |
| --------- | --------------- | ------------- |
| global    | /global/*       | ~100          |
| pty       | /pty/*          | ~150          |
| config    | /config/*       | ~100          |
| path      | /path/*         | ~50           |
| vcs       | /vcs/*          | ~80           |
| session   | /session/*      | ~600          |
| provider  | /provider/*     | ~200          |
| message   | /message/*      | ~200          |
| tool      | /tool/*         | ~100          |
| mcp       | /mcp/*          | ~150          |
| lsp       | /lsp/*          | ~50           |
| formatter | /formatter/*    | ~50           |
| auth      | /auth/*         | ~100          |
| agent     | /agent/*        | ~50           |
| skill     | /skill/*        | ~50           |

## Dosya Yapısı Planı
```
src/server/
├── index.ts           # App entry (< 100 satır)
├── app.ts             # Hono app + middleware
├── routes/
│   ├── global.ts
│   ├── pty.ts
│   ├── config.ts
│   ├── session.ts
│   ├── provider.ts
│   ├── message.ts
│   ├── mcp.ts
│   └── ...
```

## İlerleme
- [x] Analiz tamamlandı
- [ ] Routes ayrılıyor...
