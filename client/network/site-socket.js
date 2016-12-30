import createNydus from 'nydus-client'
import { isWeb } from '../env.js'
import { makeServerUrl } from './server-url'

const location = isWeb() ? window.location : new window.URL(makeServerUrl(''))
const protocol = location.protocol === 'https:' ? 'wss' : 'ws'

const siteSocket = createNydus(`${protocol}://${location.hostname}:${location.port}`)
export default siteSocket
