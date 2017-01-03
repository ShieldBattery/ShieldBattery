import createNydus from 'nydus-client'
import { makeServerUrl } from './server-url'

const location = process.webpackEnv.SB_ENV === 'web' ?
    window.location : new window.URL(makeServerUrl(''))
const protocol = location.protocol === 'https:' ? 'wss' : 'ws'

const siteSocket = createNydus(`${protocol}://${location.hostname}:${location.port}`)
export default siteSocket
