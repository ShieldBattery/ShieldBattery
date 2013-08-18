module.exports = 'shieldbattery.serverStatus'

var mod = angular.module('shieldbattery.serverStatus', [ require('./sockets') ])

mod.factory('serverStatus', function(siteSocket) {
  return new ServerStatus(siteSocket)
})

function ServerStatus(siteSocket) {
  this.connectedUsers = 0

  var self = this
  siteSocket.on('status', function(data) {
    self.connectedUsers = data.users || 0
  })
}
