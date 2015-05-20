var SimpleMap = require('../shared/simple-map')
  , listUtils = require('../shared/list-utils')
  , timeback = require('../shared/timeback')
  , autoScroll = require('./util/auto-scroll')
  , angular = require('angular')

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
                                            console.log('hundred')
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

mod.directive('autoScroll', autoScroll)

function compareLobbies(a, b) {
  return a.name.localeCompare(b.name)
}

mod.factory('joinedLobby', function($timeout, $q, $rootScope, siteSocket, psiSocket, authService) {
  return new JoinedLobbyService(
      $timeout, $q, $rootScope, siteSocket, psiSocket, authService)
})

function JoinedLobbyService($timeout, $q, $rootScope, siteSocket, psiSocket, authService) {
  this.$timeout = $timeout
  this.$q = $q
  this.$rootScope = $rootScope
  this.siteSocket = siteSocket
  this.psiSocket = psiSocket
  this.authService = authService
  this.lobby = null
  this.chat = []
  this.countingDown = false
  this.initializingGame = false
  this.myId = null

  Object.defineProperty(this, 'inLobby',
      { get: function() { return !!this.lobby }
      , enumerable: true
      })
  Object.defineProperty(this, 'isHost',
      { get: function() { return !!this.lobby && this.lobby.hostId == this.myId }
      , enumerable: true
      })

  this._connectListener = null
  this._onMessage = this._onMessage.bind(this)
  var self = this

  // TODO(tec27): abstract this out into a thing that handles re-registrations and stuff
  /*this.eventScope = $rootScope.$new(true)
  this.userTopic = null
  if (authService.isLoggedIn) {
    console.log('one')
    subUserTopic()
  }

  authService.on('userChanged', function(user) {
    console.log('two')
    if (self.userTopic) {
      console.log('three')
      self.eventScope.$destroy()
      self.eventScope = $rootScope.$new(true)
    }

    if (!user) {
      console.log('four')
      self.userTopic = null
    } else {
      console.log('five')
      subUserTopic()
    }
  })

  function subUserTopic() {
    console.log('six')
    self.userTopic = '/users/' + encodeURIComponent(authService.user.name)
    siteSocket.subscribeScope(self.eventScope, self.userTopic)
    self.eventScope.$on('/site' + self.userTopic, onUserTopic)
  }

  function onUserTopic($event, err, msg) {
    if (err) {
      return console.log('error subscribing to user topic', err)
    } else if (msg.type != 'lobby') {
      return
    }

    console.log('seven')
    self.join(msg.data.name)
  }*/
}

JoinedLobbyService.prototype._path = function(end) {
  if (!this.inLobby) {
    throw new Error('You must be in a lobby to generate paths')
  }
  return '/lobbies/' + encodeURIComponent(this.lobby.name) + (end || '')
}

JoinedLobbyService.prototype.sendChat = function(msg) {
  if (!this.inLobby) return
  this.siteSocket.publish(this._path(), { action: 'chat', text: msg })
}

JoinedLobbyService.prototype.join = function(lobbyName) {
  var self = this
    , deferred
  console.log('eight')
  if (this.inLobby) {
    console.log('nine')
    if (this.lobby.name == lobbyName) {
      console.log('ten')
      // if you're trying to join the same lobby you're already in, we immediately return a resolved
      // promise since no action is necessary
      deferred = this.$q.defer()
      deferred.resolve(this)
      return deferred.promise
    } else {
      console.log('eleven')
      this.leave()
    }
  } else if (this._connectListener) {
    console.log('twelve')
    this.leave()
  }

  console.log('thirteen')
  this._connectListener = sendJoin
  this.siteSocket.on('connect', sendJoin)
  // deferred to use if we are not currently connected, shared between sendJoinCalls
  var connectDeferred
    , connectTimeout
    , lobbyUri = '/lobbies/' + encodeURIComponent(lobbyName)
  return sendJoin()

  function sendJoin() {
    console.log('fourteen')
    if (!self.siteSocket.connected) {
      console.log('fifteen')
      if (!connectDeferred) {
        console.log('sixteen')
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

    console.log('seventeen')
    var deferred = connectDeferred ? connectDeferred : self.$q.defer()
    self.siteSocket.call(lobbyUri + '/join', function(err, myId) {
      if (err) {
        return handleError(err)
      }

      console.log('eighteen')
      self.myId = myId
      self.siteSocket.subscribe(lobbyUri, self._onMessage, subscribeCb)
    })

    function subscribeCb(err) {
      console.log('nineteen')
      if (err) {
        return handleError(err)
      }

      if (!self.lobby) {
        console.log('twenty')
        self.lobby = {}
      }
      console.log('twentyone')
      // ensure this name is available for use in generating paths immediately
      self.lobby.name = lobbyName

      deferred.resolve(self)
      if (deferred === connectDeferred) {
        console.log('twentytwo')
        self.$timeout.cancel(connectTimeout)
        connectDeferred = null
      }
    }
    console.log('twentythree')

    function handleError(err) {
      console.log('error joining: ' + err.details.msg)
      deferred.reject(err)
      if (deferred === connectDeferred) {
        self.$timeout.cancel(connectTimeout)
        connectDeferred = null
      }

      self.leave() // ensure everything gets cleaned up
    }

    return deferred.promise
  }
}

JoinedLobbyService.prototype.leave = function() {
  console.log('fifty')
  if (this.inLobby) {
    console.log('fiftyone')
    this.siteSocket.unsubscribe(this._path(), this._onMessage)
    this.siteSocket.call(this._path('/part/' + this.myId))
  }

  console.log('fiftytwo')
  this.siteSocket.removeListener('connect', this._connectListener)
  this._connectListener = null
  this.lobby = null
  this.chat.length = 0
  this.countingDown = false
  this.initializingGame = false
}

JoinedLobbyService.prototype.addComputer = function() {
  if (!this.inLobby || !this.isHost || this.lobby.players.length >= this.lobby.size) {
    return
  }

  this.siteSocket.call(this._path('/addComputer'), function(err) {
    if (err) {
      console.log('error adding computer: ' + err.details.msg)
      return
    }
  })
}

JoinedLobbyService.prototype.setRace = function(id, race) {
  if (!this.inLobby) {
    return
  }

  this.siteSocket.call(this._path('/setRace/' + id), race, function(err) {
    if (err) {
      console.log('error setting race of ' + id + ': ' + err.details.msg)
      return
    }
  })
}

JoinedLobbyService.prototype.kick = function(id) {
  if (!this.inLobby) {
    return
  }

  this.siteSocket.call(this._path('/kick/' + id), function(err) {
    if (err) {
      console.log('error kicking ' + id + ': ' + err.details.msg)
      return
    }
  })
}

JoinedLobbyService.prototype.startCountdown = function() {

  var deferred = this.$q.defer()
  this.siteSocket.call(this._path('/startCountdown'), function(err) {
    if (err) {
      console.log('error starting countdown: ' + err.details.msg)
      deferred.reject(err)
      return
    }

    deferred.resolve()
  })
  return deferred.promise
}

JoinedLobbyService.prototype._getPlayerIndex = function(id) {
  for (var i = 0, len = this.lobby.players.length; i < len; i++) {
    if (this.lobby.players[i].id == id) {
      return i
    }
  }

  return -1
}

JoinedLobbyService.prototype._getSlotIndex = function(id) {
  for (var i = 0, len = this.lobby.slots.length; i < len; i++) {
    if (this.lobby.slots[i] && this.lobby.slots[i].id == id) {
      return i
    }
  }

  return -1
}

JoinedLobbyService.prototype._systemMessage = function(msg) {
  this.chat.push({ system: true, text: msg })
}

JoinedLobbyService.prototype._onMessage = function(data) {
  switch(data.action) {
    case 'update': this._onFullUpdate(data.lobby); break
    case 'join': this._onJoin(data.slot, data.player); break
    case 'part': this._onPart(data.id); break
    case 'kick': this._onKick(data.id); break
    case 'raceChange': this._onRaceChange(data.id, data.race); break
    case 'chat': this._onChat(data.from, data.text); break
    case 'newHost': this._onNewHost(data.id, data.name); break
    case 'countdownStarted': this._onCountdownStarted(); break
    case 'countdownComplete': this._onCountdownCompleted(data.host, data.port); break
    case 'countdownAborted': this._onCountdownAborted(); break
    case 'initializationAborted': this._onInitializationAborted(); break
    case 'startGame': this._onStartGame(); break
    default: console.log('Unknown lobby action: ' + data.action); break
  }
}

JoinedLobbyService.prototype._onFullUpdate = function(lobbyData) {
  var self = this
  Object.keys(lobbyData).forEach(function(key) {
    if (key == 'players') return

    self.lobby[key] = lobbyData[key]
  })

  // match up objects in players and slots so modifying one modifies the other
  this.lobby.players = []
  for (var i = 0; i < this.lobby.slots.length; i++) {
    if (this.lobby.slots[i]) {
      this.lobby.players.push(this.lobby.slots[i])
    }
  }
}

JoinedLobbyService.prototype._onJoin = function(slot, player) {
  if (!this.lobby) return
  this.lobby.slots[slot] = player
  this.lobby.players.push(player)
  this._systemMessage(player.name + ' has joined the game')
}

JoinedLobbyService.prototype._onPart = function(id) {
  if (!this.lobby) return

  var playerIndex = this._getPlayerIndex(id)
    , slotIndex = this._getSlotIndex(id)
  if (playerIndex == -1 || slotIndex == -1) {
    console.log('no player found with id:' + id)
    return
  }
  var player = this.lobby.players[playerIndex]

  if (!player.isComputer && player.name == this.authService.user.name) {
    // this is us (from another socket), so just call leave and it will clean up everything
    return this.leave()
  }
  this.lobby.slots[slotIndex] = null
  this.lobby.players.splice(playerIndex, 1)
  this._systemMessage(player.name + ' has left the game')
}

JoinedLobbyService.prototype._onKick = function(id) {
  if (!this.lobby) return

  var playerIndex = this._getPlayerIndex(id)
    , slotIndex = this._getSlotIndex(id)
  if (playerIndex == -1 || slotIndex == -1) {
    console.log('no player found with id:' + id)
    return
  }
  var player = this.lobby.players[playerIndex]

  if (!player.isComputer && player.name == this.authService.user.name) {
    // TODO(tec27): Display some sort of message to the user to let them know they've been kicked
    return this.leave()
  }
  this.lobby.slots[slotIndex] = null
  this.lobby.players.splice(playerIndex, 1)
  this._systemMessage(player.name + (player.isComputer ?
      (' in slot ' + (slotIndex + 1) + ' has been removed') : (' has been kicked by the host')))
}

JoinedLobbyService.prototype._onRaceChange = function(id, race) {
  if (!this.lobby) return

  var playerIndex = this._getPlayerIndex(id)
  if (playerIndex == -1) {
    console.log('no player found with ID: ' + id)
    return
  }

  this.lobby.players[playerIndex].race = race
}

JoinedLobbyService.prototype._onChat = function(from, text) {
  this.chat.push({ from: from, text: text })
}

JoinedLobbyService.prototype._onNewHost = function(hostId, hostName) {
  this.lobby.hostId = hostId
  this.lobby.host = hostName
  this._systemMessage(hostName + ' is now the host')
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

JoinedLobbyService.prototype._onCountdownAborted = function() {
  this.countingDown = false
  this.initializingGame = false
  this._systemMessage('Countdown canceled')
}

JoinedLobbyService.prototype._onInitializationAborted = function() {
  this.countingDown = false
  this.initializingGame = false
  this.psiSocket.call('/game/quit', function(err) {
    if (err) {
      console.log('error quitting:')
      console.dir(err)
    }
  })
}

JoinedLobbyService.prototype._launchGame = function(host, port) {
  var self = this

  function cleanUp() {
    try {
      self.psiSocket.unsubscribe('/gameFinished', cleanUp)
    } catch (err) {
      // ignore non-existent subscription errors
    }
    self.psiSocket.call('/game/quit', function(err) {
      if (err) {
        console.log('error quitting:')
        console.dir(err)
      }
    })
  }
  // TODO(tec27): when errors happen, we need to notify the server that we couldn't launch the game

  this.psiSocket.call('/launch', function(err) {
    if (err) {
      console.log('Error launching:')
      console.dir(err)
      return cleanUp()
    }

    retrieveSettings()
  })

  function retrieveSettings() {
    self.psiSocket.call('/getSettings', timeback(1500, function(err, settings) {
      if (err) {
        console.log('Error retrieving settings:')
        console.dir(err)
        return cleanUp()
      }

      initializeSettings(settings)
    }))
  }

  function initializeSettings(settings) {
    self.psiSocket.call('/game/setSettings', settings, function(err) {
      if (err) {
        console.log('Error initializing settings:')
        console.dir(err)
        return cleanUp()
      }

      if (self.isHost) {
        createGameLobby()
      } else {
        joinGameLobby()
      }
    })
  }

  function createGameLobby() {
    self.psiSocket.call('/game/createLobby',
        { username: self.authService.user.name, map: self.lobby.map },
        function(err) {
      if (err) {
        console.log('error creating game: ')
        console.dir(err)
        return cleanUp()
      }

      // add any computer players before setting our race
      for (var i = 0; i < self.lobby.players.length; i++) {
        if (self.lobby.players[i].isComputer) {
          return addComputers()
        }
      }

      // if no computers need to be added, set our race immediately
      setGameRace()
    })
  }

  function addComputers() {
    var computers = self.lobby.players.filter(function(player) { return player.isComputer })
      , i = 0
    addComputer()

    function addComputer() {
      self.psiSocket.call('/game/addComputer', computers[i].race, function(err) {
        if (err) {
          console.log('error adding computer: ')
          console.dir(err)
          return cleanUp()
        }

        i++
        if (i < computers.length) addComputer()
        else setGameRace()
      })
    }
  }

  var joinFailures = 0
    , maxJoinFailures = 5
  function joinGameLobby() {
    var params =  { username: self.authService.user.name
                  , host: host
                  , port: port
                  }
    self.psiSocket.call('/game/joinLobby', params, function(err) {
      if (err) {
        console.log('error joining game: ')
        console.dir(err)
        joinFailures++
        if (joinFailures < maxJoinFailures) {
          console.log('retrying...')
          return setTimeout(joinGameLobby, 50)
        } else {
          console.log('too many failures, bailing out')
          return cleanUp()
        }
      }

      setGameRace()
    })
  }

  function setGameRace() {
    var race = 'r'
    for (var i = 0, len = self.lobby.players.length; i < len; i++) {
      if (self.lobby.players[i].id == self.myId) {
        race = self.lobby.players[i].race
        break
      }
    }

    self.psiSocket.call('/game/setRace', race, function(err) {
      if (err) {
        console.log('error setting race: ')
        console.dir(err)
        return cleanUp()
      }

      self.siteSocket.call(self._path('/readyUp/' + self.myId))
      self.psiSocket.subscribe('/gameFinished', cleanUp)
    })
  }
}

JoinedLobbyService.prototype._onStartGame = function() {
  if (!this.isHost) return

  this.psiSocket.call('/game/startGame', function(err) {
    if (err) {
      console.log('error starting game:')
      console.dir(err)
      return
    }
  })
  // TODO(tec27): report errors to server here as well
}

mod.controller('LobbyListCtrl', function($scope, siteSocket) {
  $scope.lobbies = []
  var lobbyMap = new SimpleMap()

  siteSocket.subscribeScope($scope, '/lobbies')
  $scope.$on('/site/lobbies', function($event, err, data) {
    if (err) {
      return console.log('error subscribing to lobbies:', err)
    }

    lobbyUpdate(data)
  })

  function lobbyUpdate(data) {
    var i, len
    if (data.action == 'full') {
      $scope.lobbies.length = 0
      for (i = 0, len = data.list.length; i < len; i++) {
        addLobby(data.list[i])
      }
    } else if (data.action == 'create') {
      addLobby(data.lobby)
    } else if (data.action == 'remove') {
      if (lobbyMap.has(data.lobby.name)) {
        lobbyMap.del(data.lobby.name)
        for (i = 0, len = $scope.lobbies.length; i < len; i++) {
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
    siteSocket.call('/lobbies/create', { name: name, map: map, size: size }, function(err) {
      $scope.btnDisabled = false
      if (err) {
        $scope.responseError = err.details.msg
      } else {
        $location.path('/lobbies/' + encodeURIComponent(name))
      }
    })
  }
})

mod.controller('LobbyViewCtrl', function($scope, $location, joinedLobby) {
  $scope.RACES =  [ { name: 'zerg', value: 'z' }
                  , { name: 'terran', value: 't' }
                  , { name: 'protoss', value: 'p' }
                  , { name: 'random', value: 'r' }
                  ]
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

  $scope.addComputer = function() {
    joinedLobby.addComputer()
  }

  $scope.setRace = function(id, race) {
    joinedLobby.setRace(id, race)
  }

  $scope.kick = function(id) {
    joinedLobby.kick(id)
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
