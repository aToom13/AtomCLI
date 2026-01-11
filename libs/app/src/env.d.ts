interface ImportMetaEnv {
  readonly VITE_ATOMCLI_SERVER_HOST: string
  readonly VITE_ATOMCLI_SERVER_PORT: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
