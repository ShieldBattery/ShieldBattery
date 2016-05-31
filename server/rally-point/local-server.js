import config from '../../config'
import createServer from 'rally-point-server'

const port = config.rallyPoint.local.port
const secret = config.rallyPoint.secret

const server = createServer('::1', port, secret)
server.bind().then(() => {
  console.log('rally-point server running on port ' + port)
})
