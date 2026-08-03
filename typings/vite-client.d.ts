/// <reference types="vite/client" />
/// <reference types="vite-plugin-svgr/client" />

// Values the client builds inject into `import.meta.env`, on top of Vite's own (MODE, DEV, PROD,
// ...). Declaring the interface here merges with the one `vite/client` provides.
interface ImportMetaEnv {
  /**
   * Server the client talks to when nothing at runtime says otherwise. Only the Electron build
   * defines it — see `client/network/server-base-url.ts` for what takes precedence.
   */
  readonly SB_SERVER?: string
  /** Client version, used to cache-bust things that aren't content-hashed. */
  readonly SB_VERSION: string
}
