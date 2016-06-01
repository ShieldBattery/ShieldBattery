export default class RallyPointServerBroadcaster {
  constructor(servers) {
    this.servers = servers
    console.dir(this.servers)
  }

  applyTo(nydus) {
    nydus.on('connection', socket => {
      nydus.subscribeClient(socket, '/rallyPoint/servers', this.servers)
    })
  }
}
