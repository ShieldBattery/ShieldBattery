import siteSocket from './site-socket'
import psiSocket from './psi-socket'

import serverStatus from '../serverstatus/server-status-checker'

export default function register() {
  ;[
    serverStatus,
  ].forEach(f => f({ siteSocket, psiSocket }))
}
