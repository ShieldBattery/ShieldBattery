import siteSocket from './site-socket'
import psiSocket from './psi-socket'

import lobbies from '../lobbies/socket-handlers'
import serverStatus from '../serverstatus/server-status-checker'

const handlers = [
  lobbies,
  serverStatus,
]

export default function register() {
  for (const handler of handlers) {
    handler({ siteSocket, psiSocket })
  }
}
