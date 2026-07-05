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
 * app `window.open` is denied and external URLs are shunted to the system browser, so we instead ask
 * the main process to run the flow in a dedicated window (see the `twitchOauthFlow` IPC).
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
 * Runs the Twitch OAuth authorization flow and resolves with its result. Rejects if the flow window
 * can't be opened or the user closes it before completing (web only; in the desktop app a closed
 * window resolves with an `access_denied` error instead).
 */
export function runTwitchOAuthFlow(authorizeUrl: string): Promise<TwitchOAuthResult> {
  return IS_ELECTRON ? runElectronFlow(authorizeUrl) : runWebPopupFlow(authorizeUrl)
}

async function runElectronFlow(authorizeUrl: string): Promise<TwitchOAuthResult> {
  const result = await ipcRenderer.invoke('twitchOauthFlow', authorizeUrl)
  if (!result) {
    throw new Error('Twitch linking is not available.')
  }
  return { type: TWITCH_OAUTH_MESSAGE_TYPE, ...result }
}

function runWebPopupFlow(authorizeUrl: string): Promise<TwitchOAuthResult> {
  return new Promise((resolve, reject) => {
    const popup = window.open(authorizeUrl, 'sbTwitchOauth', 'popup=yes,width=600,height=800')
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
