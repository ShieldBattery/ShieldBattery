import createNydus, { NydusClientOptions } from 'nydus-client'
import { getErrorStack } from '../../common/errors'
import logger from '../logging/logger'
import { clientId } from './client-id'
import { CREDENTIAL_STORAGE, UNAUTHORIZED_EMITTER } from './fetch'
import { makeServerUrl } from './server-url'

const location = !IS_ELECTRON ? window.location : new window.URL(makeServerUrl(''))
const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
const options = {
  query: {
    clientId,
    ...(window.SHIELDBATTERY_ELECTRON_API?.isDevelopment ? { developmentClient: 'true' } : {}),
  },
  withCredentials: true,
  extraHeaders: {
    get Authorization(): string {
      const token = CREDENTIAL_STORAGE.get()
      return token ? `Bearer ${token}` : ''
    },
  },
  // Makes disconnecting more reliable (less dependent on heartbeats). If we ever do unload
  // confirmation, we will probably need to implement this ourselves instead.
  closeOnBeforeunload: true,
  // A handshake that hasn't finished in this long is stuck on a dead connection, and the reconnect
  // loop can't try again until the attempt ends. A server catching up on a burst of reconnects can
  // take a while to answer, and giving up on it early opens another connection it then has to
  // serve alongside the abandoned one until its heartbeat times out, so this leaves room for that.
  connectTimeout: 20000,
  // Reconnects back off 1s, 2s, 4s... with each delay randomized anywhere from 0 to double its
  // nominal value, then capped. The cap applies after the randomization, so once a client's backoff
  // reaches it, it retries at nearly exactly the cap; what keeps clients apart is how differently
  // their earlier randomized attempts placed them within that period. After a server restart, then,
  // the cap is roughly the window that everyone's reconnects spread across.
  reconnectionDelayMax: 20000,
  reconnectionJitter: 1,
} satisfies Partial<NydusClientOptions>

const siteSocket = createNydus(`${protocol}://${location.hostname}:${location.port}`, options)

siteSocket
  .on('unauthorized', () => {
    UNAUTHORIZED_EMITTER.emit('unauthorized', 'websocket')
  })
  .on('error', err => {
    logger.error(`Site socket error: ${getErrorStack(err)}`)
  })

export default siteSocket
