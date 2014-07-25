module.exports = 'shieldbattery.serverStatus'

var angular = require('angular')

var mod = angular.module('shieldbattery.serverStatus', [ require('./sockets') ])

mod.factory('serverStatus', function(siteSocket, $rootScope) {
  return new ServerStatus(siteSocket, $rootScope)
})

function ServerStatus(siteSocket, $rootScope) {
  this.connectedUsers = '?'

  var self = this
  var eventScope = $rootScope.$new(true)
  siteSocket.subscribeScope(eventScope, '/status')
  eventScope.$on('/site/status', function($event, err, data) {
    if (err) {
      return console.log('error subscribing to /status:', err)
    }

    self.connectedUsers = data.users || 0
  })
}
