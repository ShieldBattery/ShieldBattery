export {}

declare global {
  interface Window {
    /**
     * The URL scheme (e.g. `shieldbattery`) the desktop app registers for deep links on this
     * deployment's release channel, injected by the server for logged-out web pages that offer an
     * "open in app" affordance. Undefined when the server has none configured (local dev), which
     * disables that affordance by design.
     */
    SB_DEEP_LINK_SCHEME?: string
  }
}
