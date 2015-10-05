import createNydus from 'nydus-client'

const location = window.location
const protocol = location.protocol === 'https' ? 'wss' : 'ws'

const siteSocket = createNydus(`${protocol}://${location.hostname}:${location.port}`)
export default siteSocket
