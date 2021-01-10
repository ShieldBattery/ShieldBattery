import cuid from 'cuid'
import createNydus, { NydusClientOptions } from 'nydus-client'
import { makeServerUrl } from './server-url'

const location = !IS_ELECTRON ? window.location : new window.URL(makeServerUrl(''))
const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
const options = ({
  query: { clientId: cuid() },
  withCredentials: true,
  // NOTE(tec27): The typings for engine.io stuff continue to be incomplete and don't include all
  // possible options =/
} as any) as Partial<NydusClientOptions>

const siteSocket = createNydus(`${protocol}://${location.hostname}:${location.port}`, options)
export default siteSocket
