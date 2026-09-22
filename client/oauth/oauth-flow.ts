import { OauthProvider, TypedIpcRenderer } from '../../common/ipc'

/**
 * Shared plumbing for the client-driven OAuth account linking flows (Twitch, YouTube, ...).
 * ShieldBattery authenticates with a bearer JWT rather than a cookie, so a classic server-side
 * redirect can't identify the user on the way back. Instead we drive the authorize flow from the
 * client and hand the resulting `code`/`state` to an authenticated GraphQL mutation, which performs
 * the secret code exchange server-side.
 *
 * On the web we open the authorize URL in a popup that redirects to our `/<provider>/callback`
 * route (rendered by `OAuthCallback`) and relays the result back via `postMessage`. In the desktop
 * app we ask the main process to open the authorize URL in the user's real browser (reusing the
 * user's existing login with the provider) and capture the redirect with a temporary loopback
 * server (see the `oauthFlow` IPC). The desktop flow therefore uses a fixed `localhost` redirect
 * URI, selected server-side via the `desktop` argument to each provider's `*StartLink` mutation.
 */

export const OAUTH_MESSAGE_TYPE = 'shieldbattery:oauthResult'

export interface OAuthResult {
  type: typeof OAUTH_MESSAGE_TYPE
  /** Which provider this result came from, so a listener can ignore results meant for another flow. */
  provider: OauthProvider
  /** The authorization code, present on success. */
  code?: string
  /** The state we issued, echoed back for validation. */
  state?: string
  /** An OAuth error code (e.g. `access_denied`), present if the user declined or the provider errored. */
  error?: string
  /** A human-readable description of `error`, if the provider provided one. */
  errorDescription?: string
}

const ipcRenderer = new TypedIpcRenderer()

/** The popup window name for `provider`'s flow, kept stable so a repeat click reuses the window. */
function popupName(provider: OauthProvider): string {
  return `sbOauth-${provider}`
}

/**
 * Opens the placeholder popup window for the web OAuth flow. Must be called synchronously inside
 * the user's click gesture: the authorize URL only arrives after a server round-trip, and by then
 * the click's transient activation may have expired and popup blockers would eat the window. The
 * flow navigates it to the real URL via `runOAuthFlow`. Returns null if a popup blocker denied it.
 * Never call this in the desktop app (the flow runs in the system browser there).
 */
export function openOAuthPopup(provider: OauthProvider): Window | null {
  return window.open('about:blank', popupName(provider), 'popup=yes,width=600,height=800')
}

/**
 * Runs an OAuth authorization flow for `provider` and resolves with its result. Rejects if the flow
 * window can't be opened or the user closes it before completing (web only; in the desktop app a
 * closed window resolves with an `access_denied` error instead).
 *
 * `popup`, web-only, is a placeholder window from `openOAuthPopup` to navigate to `authorizeUrl`
 * rather than opening a new window with it (see that function for why). Ignored on the desktop path.
 */
export function runOAuthFlow(
  provider: OauthProvider,
  authorizeUrl: string,
  popup?: Window | null,
): Promise<OAuthResult> {
  return IS_ELECTRON
    ? runElectronFlow(provider, authorizeUrl)
    : runWebPopupFlow(provider, authorizeUrl, popup)
}

async function runElectronFlow(
  provider: OauthProvider,
  authorizeUrl: string,
): Promise<OAuthResult> {
  const result = await ipcRenderer.invoke('oauthFlow', provider, authorizeUrl)
  if (!result) {
    throw new Error(`${provider} linking is not available.`)
  }
  return { type: OAUTH_MESSAGE_TYPE, provider, ...result }
}

/**
 * Cancels an in-flight desktop OAuth flow (e.g. the user abandoned the external browser tab),
 * settling it as a decline. No-op on the web, where the popup flow settles itself when the
 * window closes.
 */
export function cancelOAuthFlow() {
  if (IS_ELECTRON) {
    ipcRenderer.invoke('oauthFlowCancel')?.catch(() => {})
  }
}

/**
 * Runs the web popup flow. `preopened` distinguishes the popup's provenance:
 * - `null`: a placeholder popup was requested but blocked, so the flow can't proceed.
 * - a `Window`: a placeholder popup from `openOAuthPopup`, navigated to `authorizeUrl` here.
 * - `undefined`: no placeholder was pre-opened; open `authorizeUrl` directly.
 */
function runWebPopupFlow(
  provider: OauthProvider,
  authorizeUrl: string,
  preopened?: Window | null,
): Promise<OAuthResult> {
  return new Promise((resolve, reject) => {
    let popup: Window | null
    if (preopened) {
      preopened.location.href = authorizeUrl
      popup = preopened
    } else if (preopened === undefined) {
      popup = window.open(authorizeUrl, popupName(provider), 'popup=yes,width=600,height=800')
    } else {
      popup = null
    }
    if (!popup) {
      reject(new Error('Could not open the authorization window. Check your popup blocker.'))
      return
    }

    let settled = false

    const cleanup = () => {
      window.removeEventListener('message', onMessage)
      clearInterval(closedPoll)
    }

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) {
        return
      }
      const data = event.data as OAuthResult | undefined
      // Ignore a result meant for a different provider's flow (e.g. a stale message delivered
      // after this flow already settled, or another flow's popup posting concurrently).
      if (!data || data.type !== OAUTH_MESSAGE_TYPE || data.provider !== provider) {
        return
      }

      settled = true
      cleanup()
      try {
        popup.close()
      } catch {
        // Ignore: the popup may already be closing itself.
      }
      resolve(data)
    }

    window.addEventListener('message', onMessage)

    // Detect the user closing the popup without completing the flow.
    const closedPoll = setInterval(() => {
      if (popup.closed && !settled) {
        settled = true
        cleanup()
        reject(new Error('The authorization window was closed.'))
      }
    }, 500)
  })
}
