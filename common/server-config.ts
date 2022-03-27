/**
 * Config that the client requests from the server when it launches in case of an Electron app, or
 * injected into the HTML document for the web version.
 */
export interface ServerConfig {
  /** URL to the server's public directory containing static content. */
  publicAssetsUrl: string
}
