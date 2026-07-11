import { TypedIpcRenderer } from '../../common/ipc'

/**
 * Shared plumbing for the client-driven Twitch OAuth linking flow. ShieldBattery authenticates
 * with a bearer JWT rather than a cookie, so a classic server-side redirect can't identify the user
 * on the way back. Instead we drive the authorize flow from the client and hand the resulting
 * `code`/`state` to an authenticated GraphQL mutation, which performs the secret code exchange
 * server-side.
 *
 * On the web we open the authorize URL in a popup that redirects to our `/twitch/callback` route
 * (rendered by `TwitchOAuthCallback`) and relays the result back via `postMessage`. In the desktop
 * app we ask the main process to open the authorize URL in the user's real browser (reusing their
 * existing Twitch login) and capture the redirect with a temporary loopback server (see the
 * `twitchOauthFlow` IPC). The desktop flow therefore uses a fixed `localhost` redirect URI, selected
 * server-side via the `desktop` argument to `twitchStartLink`.
 */

export const TWITCH_OAUTH_MESSAGE_TYPE = 'shieldbattery:twitchOauthResult'

export interface TwitchOAuthResult {
  type: typeof TWITCH_OAUTH_MESSAGE_TYPE
  /** The authorization code, present on success. */
  code?: string
  /** The state we issued, echoed back for validation. */
  state?: string
  /** An OAuth error code (e.g. `access_denied`), present if the user declined or Twitch errored. */
  error?: string
  /** A human-readable description of `error`, if Twitch provided one. */
  errorDescription?: string
}

const ipcRenderer = new TypedIpcRenderer()

/**
 * Opens the placeholder popup window for the web OAuth flow. Must be called synchronously inside
 * the user's click gesture: the authorize URL only arrives after a server round-trip, and by then
 * the click's transient activation may have expired and popup blockers would eat the window. The
 * flow navigates it to the real URL via `runTwitchOAuthFlow`. Returns null if a popup blocker
 * denied it. Never call this in the desktop app (the flow runs in the system browser there).
 */
export function openTwitchOAuthPopup(): Window | null {
  return window.open('about:blank', 'sbTwitchOauth', 'popup=yes,width=600,height=800')
}

/**
 * Runs the Twitch OAuth authorization flow and resolves with its result. Rejects if the flow window
 * can't be opened or the user closes it before completing (web only; in the desktop app a closed
 * window resolves with an `access_denied` error instead).
 *
 * `popup`, web-only, is a placeholder window from `openTwitchOAuthPopup` to navigate to
 * `authorizeUrl` rather than opening a new window with it (see that function for why). Ignored on
 * the desktop path.
 */
export function runTwitchOAuthFlow(
  authorizeUrl: string,
  popup?: Window | null,
): Promise<TwitchOAuthResult> {
  return IS_ELECTRON ? runElectronFlow(authorizeUrl) : runWebPopupFlow(authorizeUrl, popup)
}

async function runElectronFlow(authorizeUrl: string): Promise<TwitchOAuthResult> {
  const result = await ipcRenderer.invoke('twitchOauthFlow', authorizeUrl)
  if (!result) {
    throw new Error('Twitch linking is not available.')
  }
  return { type: TWITCH_OAUTH_MESSAGE_TYPE, ...result }
}

/**
 * Cancels an in-flight desktop OAuth flow (e.g. the user abandoned the external browser tab),
 * settling it as a decline. No-op on the web, where the popup flow settles itself when the
 * window closes.
 */
export function cancelTwitchOAuthFlow() {
  if (IS_ELECTRON) {
    ipcRenderer.invoke('twitchOauthFlowCancel')?.catch(() => {})
  }
}

/**
 * Runs the web popup flow. `preopened` distinguishes the popup's provenance:
 * - `null`: a placeholder popup was requested but blocked, so the flow can't proceed.
 * - a `Window`: a placeholder popup from `openTwitchOAuthPopup`, navigated to `authorizeUrl` here.
 * - `undefined`: no placeholder was pre-opened; open `authorizeUrl` directly.
 */
function runWebPopupFlow(
  authorizeUrl: string,
  preopened?: Window | null,
): Promise<TwitchOAuthResult> {
  return new Promise((resolve, reject) => {
    let popup: Window | null
    if (preopened) {
      preopened.location.href = authorizeUrl
      popup = preopened
    } else if (preopened === undefined) {
      popup = window.open(authorizeUrl, 'sbTwitchOauth', 'popup=yes,width=600,height=800')
    } else {
      popup = null
    }
    if (!popup) {
      reject(new Error('Could not open the Twitch authorization window. Check your popup blocker.'))
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
      const data = event.data as TwitchOAuthResult | undefined
      if (!data || data.type !== TWITCH_OAUTH_MESSAGE_TYPE) {
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
        reject(new Error('The Twitch authorization window was closed.'))
      }
    }, 500)
  })
}
