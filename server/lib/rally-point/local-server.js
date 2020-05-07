import createServer from 'rally-point-server'

const secret = process.env.SB_RALLY_POINT_SECRET
const settings = JSON.parse(process.env.SB_RALLY_POINT_SERVERS)
const { port } = settings.local

const server = createServer('::', port, secret)
server.bind().then(() => {
  console.log('rally-point server running on port ' + port)
})
