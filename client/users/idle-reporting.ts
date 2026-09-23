import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { apiUrl } from '../../common/urls'
import { ReportClientIdleRequest } from '../../common/users/availability'
import logger from '../logging/logger'
import { clientId } from '../network/client-id'
import { encodeBodyAsParams, fetchJson } from '../network/fetch'
import { SocketHandlerParams } from '../network/socket-handler'

/**
 * Forwards the app's view of whether its user is idle to the server, which shows an Online user as
 * Away while every one of their connected clients reports them idle. The server forgets a client's
 * reports when it disconnects, so the current state is sent again each time the site socket
 * connects.
 *
 * Only the desktop app does this, since a web page can't see input outside itself. Web sessions
 * never report, so the server always counts them as active.
 */
export default function registerModule({ siteSocket, ipcRenderer }: SocketHandlerParams) {
  let idle = false
  /** Whether a change has arrived, which makes the initial state fetched below outdated. */
  let heardChange = false
  let connected = false
  let sending = false
  let sendQueued = false

  // One report in flight at a time, so they can't reach the server out of order. Whatever changes
  // during a report goes out in the next one.
  const sendLatest = async () => {
    sending = true
    while (sendQueued) {
      sendQueued = false
      try {
        await fetchJson<void>(apiUrl`availability/client-idle`, {
          method: 'PUT',
          body: encodeBodyAsParams<ReportClientIdleRequest>({ clientId, idle }),
        })
      } catch (err) {
        logger.error(`Error reporting idle state: ${(err as any)?.stack ?? err}`)
      }
    }
    sending = false
  }

  const report = () => {
    if (!connected) {
      return
    }
    sendQueued = true
    if (!sending) {
      sendLatest().catch(swallowNonBuiltins)
    }
  }

  siteSocket
    .on('connect', () => {
      connected = true
      report()
    })
    .on('disconnect', () => {
      connected = false
    })

  ipcRenderer.on('userIdleChanged', (event, value) => {
    heardChange = true
    idle = value
    report()
  })
  ipcRenderer
    .invoke('userIdleGetState')
    ?.then(value => {
      if (!heardChange && value !== idle) {
        idle = value
        report()
      }
    })
    .catch(swallowNonBuiltins)
}
