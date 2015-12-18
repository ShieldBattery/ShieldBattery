import siteSocket from './site-socket'
import psiSocket from './psi-socket'

import serverStatus from '../serverstatus/server-status-checker'

;[
  serverStatus,
].forEach(f => f({ siteSocket, psiSocket }))
