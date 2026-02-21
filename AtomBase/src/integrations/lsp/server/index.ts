import { Deno as Deno_ } from "./languages/deno"
import { Typescript as Typescript_ } from "./languages/typescript"
import { Vue as Vue_ } from "./languages/vue"
import { ESLint as ESLint_ } from "./languages/eslint"
import { Oxlint as Oxlint_ } from "./languages/oxlint"
import { Biome as Biome_ } from "./languages/biome"
import { Gopls as Gopls_ } from "./languages/gopls"
import { Rubocop as Rubocop_ } from "./languages/rubocop"
import { Ty as Ty_ } from "./languages/ty"
import { Pyright as Pyright_ } from "./languages/pyright"
import { ElixirLS as ElixirLS_ } from "./languages/elixir"
import { Zls as Zls_ } from "./languages/zls"
import { CSharp as CSharp_ } from "./languages/csharp"
import { FSharp as FSharp_ } from "./languages/fsharp"
import { SourceKit as SourceKit_ } from "./languages/sourcekit"
import { RustAnalyzer as RustAnalyzer_ } from "./languages/rust"
import { Clangd as Clangd_ } from "./languages/clangd"
import { Svelte as Svelte_ } from "./languages/svelte"
import { Astro as Astro_ } from "./languages/astro"
import { JDTLS as JDTLS_ } from "./languages/jdtls"
import { KotlinLS as KotlinLS_ } from "./languages/kotlin"
import { YamlLS as YamlLS_ } from "./languages/yaml"
import { LuaLS as LuaLS_ } from "./languages/lua"
import { PHPIntelephense as PHPIntelephense_ } from "./languages/php"
import { Prisma as Prisma_ } from "./languages/prisma"
import { Dart as Dart_ } from "./languages/dart"
import { Ocaml as Ocaml_ } from "./languages/ocaml"
import { BashLS as BashLS_ } from "./languages/bash"
import { TerraformLS as TerraformLS_ } from "./languages/terraform"
import { TexLab as TexLab_ } from "./languages/texlab"
import { DockerfileLS as DockerfileLS_ } from "./languages/dockerfile"
import { Gleam as Gleam_ } from "./languages/gleam"
import { Clojure as Clojure_ } from "./languages/clojure"
import { Nixd as Nixd_ } from "./languages/nixd"
import { Tinymist as Tinymist_ } from "./languages/tinymist"
import { HLS as HLS_ } from "./languages/haskell"

import type { Info as Info_, Handle as Handle_ } from "./types"

export namespace LSPServer {
    export type Info = Info_
    export type Handle = Handle_

    export const Deno = Deno_
    export const Typescript = Typescript_
    export const Vue = Vue_
    export const ESLint = ESLint_
    export const Oxlint = Oxlint_
    export const Biome = Biome_
    export const Gopls = Gopls_
    export const Rubocop = Rubocop_
    export const Ty = Ty_
    export const Pyright = Pyright_
    export const ElixirLS = ElixirLS_
    export const Zls = Zls_
    export const CSharp = CSharp_
    export const FSharp = FSharp_
    export const SourceKit = SourceKit_
    export const RustAnalyzer = RustAnalyzer_
    export const Clangd = Clangd_
    export const Svelte = Svelte_
    export const Astro = Astro_
    export const JDTLS = JDTLS_
    export const KotlinLS = KotlinLS_
    export const YamlLS = YamlLS_
    export const LuaLS = LuaLS_
    export const PHPIntelephense = PHPIntelephense_
    export const Prisma = Prisma_
    export const Dart = Dart_
    export const Ocaml = Ocaml_
    export const BashLS = BashLS_
    export const TerraformLS = TerraformLS_
    export const TexLab = TexLab_
    export const DockerfileLS = DockerfileLS_
    export const Gleam = Gleam_
    export const Clojure = Clojure_
    export const Nixd = Nixd_
    export const Tinymist = Tinymist_
    export const HLS = HLS_
}
