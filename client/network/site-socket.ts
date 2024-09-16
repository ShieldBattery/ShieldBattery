import NydusClientModule, { NydusClientOptions } from 'nydus-client'
import { clientId } from './client-id.js'
import { CREDENTIAL_STORAGE } from './fetch.js'
import { makeServerUrl } from './server-url.js'

const createNydus = NydusClientModule.default

const location = !IS_ELECTRON ? window.location : new window.URL(makeServerUrl(''))
const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
const options = {
  query: { clientId },
  withCredentials: true,
  extraHeaders: {
    Authorization: `Bearer ${CREDENTIAL_STORAGE.get()}`,
  },
  // NOTE(tec27): The typings for engine.io stuff continue to be incomplete and don't include all
  // possible options =/
} as any as Partial<NydusClientOptions>

const siteSocket = createNydus(`${protocol}://${location.hostname}:${location.port}`, options)
export default siteSocket
