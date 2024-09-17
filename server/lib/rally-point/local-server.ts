// Meant to run in a child-process, creates a local rally-point server for use during development

import createServer from 'rally-point-server'

const secret = process.env.SB_RALLY_POINT_SECRET!
const port = Number(process.env.SB_RALLY_POINT_LOCAL_PORT ?? 14098)

const server = createServer('::', port, secret, false)
server.bind().then(() => {
  console.log('rally-point server running on port ' + port)
})
