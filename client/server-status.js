module.exports = 'shieldbattery.serverStatus'

var mod = angular.module('shieldbattery.serverStatus', [ require('./sockets') ])

mod.factory('serverStatus', function(siteSocket) {
  return new ServerStatus(siteSocket)
})

function ServerStatus(siteSocket) {
  this.connectedUsers = '?'

  var self = this
  siteSocket.subscribe('/status', function(data) {
    self.connectedUsers = data.users || 0
  })
}
