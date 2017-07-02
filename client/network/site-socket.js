import cuid from 'cuid'
import createNydus from 'nydus-client'
import { makeServerUrl } from './server-url'

const location = !IS_ELECTRON ? window.location : new window.URL(makeServerUrl(''))
const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
const options = {
  query: { clientId: cuid() },
}

const siteSocket = createNydus(`${protocol}://${location.hostname}:${location.port}`, options)
export default siteSocket
