var SimpleMap = require('../shared/simple-map')
  , listUtils = require('../shared/list-utils')

module.exports = 'shieldbattery.lobby'

var mod = angular.module('shieldbattery.lobby', [ require('./sockets') ])

mod.config(function($routeProvider) {
  $routeProvider
    .when('/lobbies', { templateUrl: '/partials/lobbyList', controller: 'LobbyListCtrl' })
    .when('/lobbies/new', { templateUrl: '/partials/lobbyCreate', controller: 'LobbyCreateCtrl' })
    .when('/lobbies/:name', { templateUrl: '/partials/lobbyView', controller: 'LobbyViewCtrl' })
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
        $scope.lobbies.push(list[i])
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

mod.controller('LobbyViewCtrl',
    function($scope, $routeParams, $location, $timeout, authService, siteSocket, psiSocket) {
  // TODO(tec27): ideally the joined lobby would be maintained in a service, and the route would
  // make sure we joined *before* starting this controller. For the sake of development speed I am
  // skipping this for now, but will soon implement it this way

  $scope.responseError = null
  $scope.chat = []
  $scope.lobby = {}
  $scope.isHost = false

  $scope.countingDown = false
  $scope.countdownSeconds = null

  $scope.initializingGame = false

  $scope.sendChat = function(text) {
    if (!$scope.chatForm.$valid) return
    siteSocket.emit('lobbies/chat', { msg: text })
    $scope.chatMsg = ''
    $scope.chatForm.$setPristine(true)
  }

  $scope.startCountdown = function() {
    if (!$scope.isHost) return
    siteSocket.emit('lobbies/startCountdown', function(err) {
      if (err) {
        console.log('error starting countdown: ' + err.msg)
        return
      }
    })
  }

  var unsubscribers = [ siteSocket.on('connect', joinThisLobby)
                      , siteSocket.on('lobbies/joined/message', onMessage)
                      ]

  var inLobby = false
  joinThisLobby()
  $scope.$on('$destroy', function(event) {
    // unsubscribe when this controller gets destroyed
    for (var i = 0, len = unsubscribers.length; i < len; i++) {
      unsubscribers[i]()
    }
    if (inLobby) {
      siteSocket.emit('lobbies/part', function(err) {})
    }
  })

  function joinThisLobby() {
    inLobby = false
    $scope.isHost = false
    siteSocket.emit('lobbies/join', { name: $routeParams.name }, function(err, lobbyData) {
      if (err) {
        console.log('error joining: ' + err.msg)
        $location.path('/lobbies')
        return
      }

      Object.keys(lobbyData).forEach(function(key) {
        $scope.lobby[key] = lobbyData[key]
      })
      for (var i = 0, len = $scope.lobby.players.length; i < len; i++) {
        if ($scope.lobby.players[i].name == authService.user.name) {
          $scope.isHost = $scope.lobby.players[i].isHost
          break
        }
      }
      inLobby = true
    })
  }

  function onMessage(data) {
    switch (data.action) {
      case 'join': onJoin(data.slot, data.player); break
      case 'part': onPart(data.slot); break
      case 'chat': onChat(data.from, data.text); break
      case 'countdownStarted': onCountdownStarted(); break
      case 'countdownComplete': onCountdownCompleted(data.host, data.port); break
      default: console.log('Unknown lobby action: ' + data.action); break
    }
  }

  function onJoin(slot, player) {
    $scope.lobby.slots[slot] = player
    $scope.lobby.players.push(player)
    $scope.chat.push({ from: '<SYSTEM>', text: player.name + ' has joined the game' })
  }

  function onPart(slot) {
    var player = $scope.lobby.slots[slot]
      , index = $scope.lobby.players.indexOf(player)
    $scope.lobby.slots[slot] = null
    if (index >= 0) {
      $scope.lobby.players.splice(index, 1)
    }
    $scope.chat.push({ from: '<SYSTEM>', text: player.name + ' has left the game' })
  }

  function onChat(from, text) {
    $scope.chat.push({ from: from, text: text })
  }

  function onCountdownStarted() {
    $scope.countingDown = true
    $scope.countdownSeconds = 5
    $timeout(countdownTick, 1000)

    function countdownTick() {
      $scope.countdownSeconds--
      if ($scope.isHost && $scope.countdownSeconds == 3) {
        // we need to give the host some extra time to get the game ready for connections
        launchGame()
      }
      if ($scope.countdownSeconds > 0) {
        $timeout(countdownTick, 1000)
      }
    }
  }

  function onCountdownCompleted(host, port) {
    $scope.countingDown = false
    $scope.initializingGame = true
    if ($scope.isHost) {
      // we already did out part, and this host/port is our own, so we can ignore it
      return
    }

    launchGame(host, port)
  }

  // psi communication
  function launchGame(host, port) {
    psiSocket.once('game/status', handleStatus)
    psiSocket.emit('launch', function(err) {
      if (err) {
        console.log('Error launching:')
        console.dir(err)
      }
    })

    function handleStatus(status) {
      if (status != 'init') return

      var plugins = [ 'wmode.dll' ]
      psiSocket.emit('game/load', plugins, onLoad)
    }

    function onLoad(errors) {
      var launch = true
      Object.keys(errors).forEach(function(key) {
        console.log('Error loading ' + key + ': ' + errors[key])
        launch = false
      })
      if (!launch) return

      var race = 'r'
      for (var i = 0, len = $scope.lobby.players.length; i < len; i++) {
        if ($scope.lobby.players[i].name == authService.user.name) {
          race = $scope.lobby.players[i].race
          break
        }
      }

      if ($scope.isHost) {
        psiSocket.emit('game/start', { username: authService.user.name
                                  , map: $scope.lobby.map
                                  , race: race
                                  })
      } else {
        psiSocket.emit('game/join',  { username: authService.user.name
                                  , address: host
                                  , port: port
                                  , race: race
                                  })
      }
    }
  }

})
