import createNydus, { NydusClientOptions } from 'nydus-client'
import { clientId } from './client-id'
import { CREDENTIAL_STORAGE } from './fetch'
import { makeServerUrl } from './server-url'

const location = !IS_ELECTRON ? window.location : new window.URL(makeServerUrl(''))
const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
const options = {
  query: { clientId },
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
} satisfies Partial<NydusClientOptions>

const siteSocket = createNydus(`${protocol}://${location.hostname}:${location.port}`, options)
export default siteSocket
