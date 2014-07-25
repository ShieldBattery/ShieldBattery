module.exports = 'shieldbattery.sockets'
var nydus = require('nydus-client')
  , EventEmitter = require('events').EventEmitter
  , inherits = require('inherits')
  , angular = require('angular')

var mod = angular.module('shieldbattery.sockets', [])

mod.factory('siteSocket', function($rootScope) {
  return new AngularSocket(null, $rootScope, '/site')
})

mod.factory('psiSocket', function($rootScope) {
  return new AngularSocket('wss://lifeoflively.net:33198', $rootScope, '/psi')
})

inherits(AngularSocket, EventEmitter)
function AngularSocket(host, $rootScope, prefix) {
  EventEmitter.call(this)
  this.host = host
  this.scope = $rootScope
  this.prefix = prefix
  this.connected = false
  this.lastError = null

  if (!this.host) {
    this.host = (location.protocol == 'https:' ? 'wss://' : 'ws://') + location.hostname
  }

  ;[ '_onConnect', '_onError', '_onDisconnect' ].forEach(function(func) {
    this[func] = this[func].bind(this)
  }, this)

  var self = this
  ; [ 'call'
    , 'subscribe'
    , 'unsubscribe'
    , 'publish'
    ].forEach(function(func) {
    this[func] = function() {
      self.socket[func].apply(self.socket, arguments)
    }
  }, this)

  Object.defineProperty(this, 'router',
    { get: function() { return this.socket.router }
    , enumerable: true
    })

  // we'd rather not have socket errors cause a bunch of console spam for no good reason
  this.on('error', function() {})
}

;['addListener'
, 'on'
, 'once'
, 'removeListener'
, 'removeAllListeners'
, 'listeners'
].forEach(function(method) {
  var origMethod = AngularSocket.prototype[method]
  AngularSocket.prototype[method] = genEventEmitterMethod(method, origMethod)
})

function genEventEmitterMethod(method, origMethod) {
  return function(ev, fn) {
    switch(ev) {
      case 'connect':
      case 'disconnect':
      case 'error':
        return origMethod.call(this, ev, fn)
      default:
        this.socket[method](ev, fn)
        return this
    }
  }
}

AngularSocket.prototype.connect = function() {
  if (this.connected) return this

  this.socket = nydus(this.host)
  this.socket.on('connect', this._onConnect)
    .on('error', this._onError)
    .on('disconnect', this._onDisconnect)

  var self = this
  this.socket.socket.on('message', function() {
    setTimeout(function() {
      self.scope.$apply()
    }, 0)
  })

  return this
}

AngularSocket.prototype.disconnect = function() {
  if (!this.connected) return this

  this.socket.socket.close()
  return this
}

/**
 * Subscribes (persistently) to a particular topic for a particular scope.
 * If the socket is not connected, or disconnects and reconnects the subscription will be renewed.
 * Events are broadcasted on the scope specified, using this socket's prefix and the topicPath as
 * the name. On scope destruction, the topic will be unsubscribed from.
 */
AngularSocket.prototype.subscribeScope = function(scope, topicPath) {
  var broadcastName = this.prefix + topicPath
    , self = this

  function sub() {
    if (!self.connected) return
    self.subscribe(topicPath, onEvent, function(err) {
      if (err) {
        scope.$broadcast(broadcastName, err)
      }
    })
  }

  function onEvent(event) {
    scope.$broadcast(broadcastName, null, event)
  }

  sub()
  this.on('connect', sub)
  scope.$on('$destroy', function() {
    self.removeListener('connect', sub)
    self.unsubscribe(topicPath, onEvent)
  })
}

AngularSocket.prototype._onConnect = function() {
  console.log('socket connected.')
  this.connected = true
  this.emit('connect')
  this.scope.$apply()
}

AngularSocket.prototype._onError = function(err) {
  console.log('socket error!')
  console.dir(err)
  var self = this
  this.scope.$apply(function() {
    self.lastError = err
    self.emit('error', err)
  })
}

AngularSocket.prototype._onDisconnect = function() {
  console.log('socket disconnected.')
  var self = this
  // onDisconnect is called immediately (in the same event loop turn) if disconnected manually.
  // To prevent this from causing nested $digest loops, we defer $apply to the next turn.
  setTimeout(function() {
    self.connected = false
    self.emit('disconnect')
    self.scope.$apply()
  }, 0)
}
