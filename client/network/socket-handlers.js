import siteSocket from './site-socket'
import psiSocket from './psi-socket'

import lobbies from '../lobbies/socket-handlers'
import serverStatus from '../serverstatus/server-status-checker'
import settingsPsi from '../settings/psi-handlers'

const handlers = [
  lobbies,
  serverStatus,
  settingsPsi
]

export default function register() {
  for (const handler of handlers) {
    handler({ siteSocket, psiSocket })
  }
}
