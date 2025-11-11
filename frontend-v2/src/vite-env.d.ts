/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/**
 * Runtime Configuration
 * Loaded from public/config.js at runtime
 */
interface RuntimeConfig {
  API_BASE_URL?: string
  ENVIRONMENT?: string
  DEBUG?: boolean
}

interface Window {
  ENV_CONFIG?: RuntimeConfig
}
