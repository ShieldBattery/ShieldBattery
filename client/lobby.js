var SimpleMap = require('../shared/simple-map')
  , listUtils = require('../shared/list-utils')

module.exports = 'shieldbattery.lobby'

var mod = angular.module('shieldbattery.lobby', [ require('./sockets') ])

mod.config(function($routeProvider) {
  $routeProvider
    .when('/lobbies', { templateUrl: '/partials/lobbyList', controller: 'LobbyListCtrl' })
    .when('/lobbies/new', { templateUrl: '/partials/lobbyCreate', controller: 'LobbyCreateCtrl' })
    .when('/lobbies/:name', { templateUrl: '/partials/lobbyView'
                            , controller: 'LobbyViewCtrl'
                            , resolve:  { lobby: function($route, joinedLobby) {
                                            // TODO(tec27): take users to a confirmation screen if
                                            // they're already in another lobby, etc.
                                            var lobbyName = $route.current.params.name
                                            return joinedLobby.join(lobbyName)
                                          }
                                        }
                            })
    .when('/loading/:name', { templateUrl: '/partials/lobbyLoading'
                            , controller: 'LobbyLoadingCtrl'
                            })
})

mod.filter('encodeUriComponent', function() {
  return function(input) {
    return encodeURIComponent(input)
  }
})

mod.directive('autoScroll', function() {
  function link(scope, elem, attrs, ctrl) {
    var locked = true
      , domElem = elem[0]
      , triggeredScroll = false

    elem.bind('scroll', function() {
      if (!triggeredScroll) {
        scope.$apply(function() { locked = isAtBottom(domElem) })
      }
    })

    scope.$watch(function() {
      if (locked) {
        triggeredScroll = true
        doScroll(domElem)
        triggeredScroll = false
      }
    })
  }

  function doScroll(domElem) {
    domElem.scrollTop = domElem.scrollHeight
  }

  function isAtBottom(domElem) {
    return (domElem.scrollTop + domElem.clientHeight) === domElem.scrollHeight
  }

  return  { priority: 1
          , restrict: 'A'
          , link: link
          }
})

function compareLobbies(a, b) {
  return a.name.localeCompare(b.name)
}

mod.factory('joinedLobby', function($timeout, $q, siteSocket, psiSocket, authService) {
  return new JoinedLobbyService($timeout, $q, siteSocket, psiSocket, authService)
})

function JoinedLobbyService($timeout, $q, siteSocket, psiSocket, authService) {
  this.$timeout = $timeout
  this.$q = $q
  this.siteSocket = siteSocket
  this.psiSocket = psiSocket
  this.authService = authService
  this.lobby = null
  this.chat = []
  this.countingDown = false
  this.initializingGame = false
  this.joinInProgress = false

  Object.defineProperty(this, 'inLobby',
      { get: function() { return !!this.lobby }
      , enumerable: true
      })
  Object.defineProperty(this, 'isHost',
      { get: function() { return !!this.lobby && this.lobby.host == authService.user.name }
      , enumerable: true
      })

  this._unsubOnLeave = []

  var self = this
  // received when we connect and are already in a lobby, or when another socket for our account
  // (e.g. another tab) joins a lobby
  siteSocket.on('lobbies/join', function(lobbyName) {
    self.join(lobbyName)
  })
  // received when another tab leaves a lobby
  siteSocket.on('lobbies/part', function() {
    self.lobby = null
    self.leave()
  })
}

JoinedLobbyService.prototype.sendChat = function(msg) {
  if (!this.inLobby) return
  this.siteSocket.emit('lobbies/chat', { msg: msg })
}

JoinedLobbyService.prototype.join = function(lobbyName) {
  var self = this
    , deferred
  if (this.inLobby) {
    if (this.lobby.name == lobbyName) {
      // if you're trying to join the same lobby you're already in, we immediately return a resolved
      // promise since no action is necessary
      deferred = this.$q.defer()
      deferred.resolve(this)
      return deferred.promise
    } else {
      this.leave()
    }
  } else if (this._unsubOnLeave.length) {
    this.leave()
  } else if (this.joinInProgress) {
    // TODO(tec27): I think we could return our previously returned promise here if the lobby name
    // is the same, and make this more friendly (I think this is an edge case anyway, though)
    deferred = this.$q.defer()
    deferred.reject({ msg: 'There is already another join action in progress' })
    return deferred.promise
  }

  this._unsubOnLeave =  [ this.siteSocket.on('connect', sendJoin)
                        , this.siteSocket.on('lobbies/joined/message', this._onMessage.bind(this))
                        ]
  // deferred to use if we are not currently connected, shared between sendJoinCalls
  var connectDeferred
    , connectTimeout
  return sendJoin()

  function sendJoin() {
    if (!self.siteSocket.connected) {
      if (!connectDeferred) {
        connectDeferred = self.$q.defer()
        connectTimeout = self.$timeout(function() {
          connectDeferred.reject({ msg: 'Not connected' })
          connectDeferred = null
          connectTimeout = null
          self.leave()
        }, 5000)
      }
      return connectDeferred.promise
    }

    var deferred = connectDeferred ? connectDeferred : self.$q.defer()
    self.siteSocket.emit('lobbies/join', { name: lobbyName }, function(err, lobbyData) {
      if (err) {
        console.log('error joining: ' + err.msg)
        deferred.reject(err)
        if (deferred === connectDeferred) {
          self.$timeout.cancel(connectTimeout)
          connectDeferred = null
        }

        self.leave() // ensure everything gets cleaned up
        return
      }

      if (!self.lobby) {
        self.lobby = {}
      }
      Object.keys(lobbyData).forEach(function(key) {
        self.lobby[key] = lobbyData[key]
      })

      deferred.resolve(self)
      if (deferred === connectDeferred) {
        self.$timeout.cancel(connectTimeout)
        connectDeferred = null
      }
    })

    return deferred.promise
  }
}

JoinedLobbyService.prototype.leave = function() {
  if (this.inLobby) {
    this.siteSocket.emit('lobbies/part', function(err) {})
  }

  this._unsubOnLeave.forEach(function(unsub) { unsub() })
  this._unsubOnLeave.length = 0
  this.lobby = null
  this.chat.length = 0
  this.countingDown = false
  this.initializingGame = false
  this.joinInProgress = false
}

JoinedLobbyService.prototype.startCountdown = function() {
  if (!this.inLobby || !this.isHost) return

  var deferred = this.$q.defer()
  this.siteSocket.emit('lobbies/startCountdown', function(err) {
    if (err) {
      console.log('error starting countdown: ' + err.msg)
      deferred.reject(err)
      return
    }

    deferred.resolve()
  })
  return deferred.promise
}

JoinedLobbyService.prototype._systemMessage = function(msg) {
  this.chat.push({ system: true, text: msg })
}

JoinedLobbyService.prototype._onMessage = function(data) {
  switch(data.action) {
    case 'join': this._onJoin(data.slot, data.player); break
    case 'part': this._onPart(data.slot); break
    case 'chat': this._onChat(data.from, data.text); break
    case 'newHost': this._onNewHost(data.name); break
    case 'countdownStarted': this._onCountdownStarted(); break
    case 'countdownComplete': this._onCountdownCompleted(data.host, data.port); break
    case 'startGame': this._onStartGame(); break
    default: console.log('Unknown lobby action: ' + data.action); break
  }
}

JoinedLobbyService.prototype._onJoin = function(slot, player) {
  if (!this.lobby) return
  this.lobby.slots[slot] = player
  this.lobby.players.push(player)
  this._systemMessage(player.name + ' has joined the game')
}

JoinedLobbyService.prototype._onPart = function(slot) {
  if (!this.lobby) return
  var player = this.lobby.slots[slot]
  this.lobby.slots[slot] = null
  for (var i = 0, len = this.lobby.players.length; i < len; i++) {
    if (this.lobby.players[i].name == player.name) {
      this.lobby.players.splice(i, 1)
      break
    }
  }
  this._systemMessage(player.name + ' has left the game')
}

JoinedLobbyService.prototype._onChat = function(from, text) {
  this.chat.push({ from: from, text: text })
}

JoinedLobbyService.prototype._onNewHost = function(host) {
  this.lobby.host = host
  this._systemMessage(host + ' is now the host')
}

JoinedLobbyService.prototype._onCountdownStarted = function() {
  this.countingDown = true
  this.countdownSeconds = 5
  this.$timeout(countdownTick, 1000)

  var self = this
  function countdownTick() {
    self.countdownSeconds--
    if (self.countdownSeconds > 0) {
      self.$timeout(countdownTick, 1000)
    }
  }
}

JoinedLobbyService.prototype._onCountdownCompleted = function(host, port) {
  this.countingDown = false
  this.initializingGame = true
  this._launchGame(host, port)
}

JoinedLobbyService.prototype._launchGame = function(host, port) {
  var subs = []
    , self = this

  function cleanUp() {
    subs.forEach(function(unsub) {
      unsub()
    })
    subs.length = 0
  }
  // TODO(tec27): when errors happen, we need to notify the server that we couldn't launch the game

  this.psiSocket.emit('launch', function(err) {
    if (err) {
      console.log('Error launching:')
      console.dir(err)
      return cleanUp()
    }

    loadPlugins()
  })


  function loadPlugins() {
    var plugins = [ 'wmode.dll' ]
    self.psiSocket.emit('game/load', plugins, function(errs) {
      var launch = true
      Object.keys(errs).forEach(function(key) {
        console.log('Error loading ' + key + ': ' + errs[key])
        launch = false
      })
      if (!launch) {
        return cleanUp()
      }

      initiateGameMode()
    })
  }

  function initiateGameMode() {
    if (self.isHost) {
      self.psiSocket.emit('game/hostMode')
      createGameLobby()
    } else {
      self.psiSocket.emit('game/joinMode')
      joinGameLobby()
    }
  }

  function createGameLobby() {
    self.psiSocket.emit('game/createLobby',
        { username: self.authService.user.name, map: self.lobby.map },
        function(err) {
      if (err) {
        console.log('error creating game: ' + err.msg)
        return cleanUp()
      }

      setRace()
    })
  }

  var joinFailures = 0
    , maxJoinFailures = 5
  function joinGameLobby() {
    var params =  { username: self.authService.user.name
                  , host: host
                  , port: port
                  }
    self.psiSocket.emit('game/joinLobby', params, function(err) {
      if (err) {
        console.log('error joining game: ' + err.msg)
        joinFailures++
        if (joinFailures < maxJoinFailures) {
          console.log('retrying...')
          return setTimeout(joinGameLobby, 50)
        } else {
          console.log('too many failures, bailing out')
          return cleanUp()
        }
      }

      setRace()
    })
  }

  function setRace() {
    var race = 'r'
    for (var i = 0, len = self.lobby.players.length; i < len; i++) {
      if (self.lobby.players[i].name == self.authService.user.name) {
        race = self.lobby.players[i].race
        break
      }
    }

    self.psiSocket.emit('game/setRace', race, function(err) {
      if (err) {
        console.log('error setting race: ' + err.msg)
        return cleanUp()
      }

      self.siteSocket.emit('lobbies/readyUp')
      subs.push(self.psiSocket.on('game/gameFinished', function() {
        self.psiSocket.emit('game/quit')
        cleanUp()
      }))
    })
  }
}

JoinedLobbyService.prototype._onStartGame = function() {
  if (!this.isHost) return

  this.psiSocket.emit('game/startGame', function(err) {
    if (err) {
      console.log('error starting game: ' + err)
      return
    }
  })
  // TODO(tec27): report errors to server here as well
}

mod.controller('LobbyListCtrl', function($scope, siteSocket) {
  $scope.lobbies = []
  var lobbyMap = new SimpleMap()

  var subscriptions = [ siteSocket.on('connect', subscribeToLobbies)
                      , siteSocket.on('lobbies/message', lobbyUpdate)
                      ]

  subscribeToLobbies()
  $scope.$on('$destroy', function(event) {
    // unsubscribe when this controller gets destroyed
    for (var i = 0, len = subscriptions.length; i < len; i++) {
      subscriptions[i]()
    }
    siteSocket.emit('lobbies/unsubscribe')
  })

  function subscribeToLobbies() {
    siteSocket.emit('lobbies/subscribe', function(list) {
      $scope.lobbies.length = 0
      for (var i = 0, len = list.length; i < len; i++) {
        addLobby(list[i])
      }
    })
  }

  function lobbyUpdate(data) {
    if (data.action == 'create') {
      addLobby(data.lobby)
    } else if (data.action == 'remove') {
      if (lobbyMap.has(data.lobby.name)) {
        lobbyMap.del(data.lobby.name)
        for (var i = 0, len = $scope.lobbies.length; i < len; i++) {
          if (compareLobbies(data.lobby, $scope.lobbies[i]) === 0) {
            $scope.lobbies.splice(i, 1)
            break
          }
        }
      }
    } else if (data.action == 'update') {
      if (lobbyMap.has(data.lobby.name)) {
        var stored = lobbyMap.get(data.lobby.name)
        Object.keys(data.lobby).forEach(function(key) {
          stored[key] = data.lobby[key]
        })
      } else {
        addLobby(data.lobby)
      }
    }
  }

  function addLobby(lobby) {
    lobbyMap.put(lobby.name, lobby)
    listUtils.sortedInsert($scope.lobbies, lobby, compareLobbies)
  }
})

mod.controller('LobbyCreateCtrl', function($scope, $location, siteSocket) {
  $scope.btnDisabled = false
  $scope.responseError = null

  // TODO(tec27): ideally we wouldn't send up the full map path. fixing this is probably dependent
  // on (or at least not worth doing until) better map transfers ("CDN" backed)
  $scope.createLobby = function(name, map, size) {
    $scope.responseError = null
    if (!$scope.lobbyForm.$valid) return

    $scope.btnDisabled = true
    siteSocket.emit('lobbies/create', { name: name, map: map, size: size }, function(err) {
      $scope.btnDisabled = false
      if (err) {
        $scope.responseError = err.msg
      } else {
        $location.path('/lobbies/' + encodeURIComponent(name))
      }
    })
  }
})

mod.controller('LobbyViewCtrl', function($scope, $location, joinedLobby) {
  $scope.joinedLobby = joinedLobby

  $scope.sendChat = function(text) {
    if (!$scope.chatForm.$valid) return
    joinedLobby.sendChat($scope.chatMsg)
    $scope.chatMsg = ''
    $scope.chatForm.$setPristine(true)
  }

  $scope.startCountdown = function() {
    joinedLobby.startCountdown()
  }

  $scope.leaveLobby = function() {
    joinedLobby.leave()
  }

  // watch the lobby status so that we can redirect elsewhere if the user leaves this lobby
  $scope.$watch('joinedLobby.inLobby', function(inLobby) {
    if (!inLobby) {
      $location.path('/')
    }
  })
  // watch for the lobby going into initialization mode
  $scope.$watch('joinedLobby.initializingGame', function(initializing) {
    if (initializing) {
      $location.path('/loading/' + encodeURIComponent(joinedLobby.lobby.name))
    }
  })
})

mod.controller('LobbyLoadingCtrl', function($scope, $routeParams, $location, joinedLobby) {
  if (!joinedLobby.inLobby || $routeParams.name != joinedLobby.lobby.name ||
      !joinedLobby.initializingGame) {
    $location.path('/lobbies/' + encodeURIComponent($routeParams.name)).replace()
  }
  $scope.joinedLobby = joinedLobby
})
