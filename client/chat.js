var SimpleMap = require('../shared/simple-map')
  , autoScroll = require('./util/auto-scroll')
  , angular = require('angular')
require('angular-route')

module.exports = 'shieldbattery.chat'

var mod = angular.module('shieldbattery.chat', [ require('./sockets'), 'ngRoute' ])

mod.config(function($routeProvider) {
  $routeProvider
    .when('/chat', { templateUrl: '/partials/chatInterface', controller: 'ChatInterfaceCtrl' })
})

mod.directive('autoScroll', autoScroll)

mod.factory('chat', function($rootScope, siteSocket, authService) {
  return new ChatService($rootScope, siteSocket, authService)
})

function ChatService($rootScope, siteSocket, authService) {
  this.$rootScope = $rootScope
  this.siteSocket = siteSocket
  this.authService = authService
  this.joinedChatChannels = []
  this.joinedChatChannelsMap = new SimpleMap()
  this.messagesChatChannelMap = new SimpleMap()
  this.myUserName = null
  this.joinsInProgressMap = new SimpleMap()

  this._connectListener = null
  this._onMessage = this._onMessage.bind(this)
  var self = this

  // TODO(tec27): abstract this out into a thing that handles re-registrations and stuff
  this.eventScope = $rootScope.$new(true)
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
    } else if (msg.type != 'chatChannel') {
      return
    }

    console.log('seven')
    self.join(msg.data.name)
  }
}

ChatService.prototype._inChannel = function(chatChannelName) {
  return this.joinedChatChannels.indexOf(chatChannelName) > -1
}

ChatService.prototype.join = function(chatChannelName) {
  console.log('eight')

  var self = this
  if (this._inChannel(chatChannelName)) {
    console.log('ten')
    return
  } 

  console.log('eleven')
  sendJoin()

  function sendJoin() {
    self.siteSocket.call('/chat/' + encodeURIComponent(chatChannelName) + '/join',
        { name: chatChannelName }, function(err, myUserName) {
      console.log('twelve')
      self.myUserName = myUserName
      self.siteSocket.subscribe('/chat/' + encodeURIComponent(chatChannelName), self._onMessage,
          subscribeCb)
    })

    function subscribeCb(err) {
      console.log('thirteen')
      if (err) {
        console.log('error joining: ' + err.details.msg)
        // TODO(2Pac): Clean up
      }

      if (!self.joinedChatChannelsMap.has(chatChannelName)) {
        console.log('fourteen')
        self.joinedChatChannelsMap.put(chatChannelName, {})
      }

      console.log('fifteen')
      if (!self._inChannel(chatChannelName)) {
        console.log('sixteen')
        self.joinedChatChannels.push(chatChannelName)
      }
    }
  }
}

ChatService.prototype.create = function(chatChannelName) {
  if (this._inChannel(chatChannelName)) {
    console.log('ten')
    return
  }

  var self = this
  this.siteSocket.call('/chat/create', { name: chatChannelName }, function(err) {
    console.log('hundred')
    self.join(chatChannelName)
  })
}

ChatService.prototype.sendChat = function(chatChannelName, msg) {
  this.siteSocket.publish('/chat/' + encodeURIComponent(chatChannelName),
      { action: 'chat', channel: chatChannelName, text: msg })
}

ChatService.prototype.leave = function(chatChannelName) {
  console.log('twenty')
  if (!this._inChannel(chatChannelName)) {
    console.log('twentyone')
    return
  }

  var index
  console.log('twentyfour')
  this.siteSocket.unsubscribe('/chat/' + encodeURIComponent(chatChannelName), this._onMessage)
  console.log('twentythree')
  this.siteSocket.call('/chat/' + encodeURIComponent(chatChannelName) + '/part/' + this.myUserName)
  if (this.joinedChatChannelsMap.has(chatChannelName)) {
    console.log('twentythreeandhalf')
    index = this.joinedChatChannelsMap.get(chatChannelName).users.indexOf(this.myUserName)
    if (index > -1) {
      console.log('twentythreeandquarter')
      this.joinedChatChannelsMap.get(chatChannelName).users.splice(index, 1)
    }
    this.joinedChatChannelsMap.del(chatChannelName)
  }
  index = this.joinedChatChannels.indexOf(chatChannelName)
  if (index > -1) {
    console.log('twentyfive')
    this.joinedChatChannels.splice(index, 1)
  }
}

ChatService.prototype._onMessage = function(data) {
  switch(data.action) {
    case 'update': this._onFullUpdate(data.chatChannel); break
    case 'join': this._onJoin(data.chatChannelName, data.user); break
    case 'part': this._onPart(data.name, data.user); break
    case 'chat': this._onChat(data.channel, data.from, data.text); break
    default: console.log('Unknown chat action: ' + data.action); break
  }
}

ChatService.prototype._onFullUpdate = function(chatChannelData) {
  var chatChannel = this.joinedChatChannelsMap.get(chatChannelData.name)
  console.log('_onFullUpdate')
  console.log(chatChannelData.users)
  console.log(chatChannel.users)
  Object.keys(chatChannelData).forEach(function(key) {
    chatChannel[key] = chatChannelData[key]
  })
}

ChatService.prototype._onJoin = function(chatChannelName, user) {
  var chatChannel = this.joinedChatChannelsMap.get(chatChannelName)
  if (!chatChannel) return
  
  console.log('_onJoin')
  chatChannel.users.push(user)
  console.log(chatChannel.users)

  var log = this.messagesChatChannelMap.get(chatChannel.name)
  if (!log) {
    log = []
    this.messagesChatChannelMap.put(chatChannel.name, log)
  }
  log.push({ system: true, text: user + ' has joined the channel' })
}

ChatService.prototype._onPart = function(chatChannelName, user) {
  var chatChannel = this.joinedChatChannelsMap.get(chatChannelName)
  if (!chatChannel) {
    console.log('thousand')
    return
  }

  console.log('thousandone')
  var index = chatChannel.users.indexOf(user)
  if (index > -1) {
    if (chatChannel.users[index] == this.authService.user.name) {
      console.log('fifty')
      // this is us (from another socket), so just call leave and it will clean up everything
      return this.leave(chatChannelName)
    }
    console.log('fiftyone')
    chatChannel.users.splice(index, 1)
    console.log(this.joinedChatChannelsMap.get(chatChannelName).users)

    var log = this.messagesChatChannelMap.get(chatChannel.name)
    if (!log) {
      log = []
      this.messagesChatChannelMap.put(chatChannel.name, log)
    }
    log.push({ system: true, text: user + ' has left the channel' })
  }
}

ChatService.prototype._onChat = function(chatChannelName, from, text) {
  var log = this.messagesChatChannelMap.get(chatChannelName)
  if (!log) {
    log = []
    this.messagesChatChannelMap.put(chatChannelName, log)
  }
  log.push({ from: from, text: text })
}

mod.controller('ChatInterfaceCtrl', function($scope, chat) {
  $scope.chat = chat

  $scope.joinChat = function(chatChannelName) {
    if (!$scope.joinChatForm.$valid) {
      if (chat.joinedChatChannelsMap.has(chatChannelName)) {
        $scope.chatChannelName = ''
        $scope.joinChatForm.$setPristine(true)
      }
      return
    }
    chat.create(chatChannelName)
    $scope.chatChannelName = ''
    $scope.joinChatForm.$setPristine(true)
  }
})

mod.controller('ChatCtrl', function($scope, chat) {
  $scope.chat = chat
})

mod.directive('sbChatChannel', function() {
  function controller($scope, chat) {
    $scope.chat = chat
    $scope.minimized = false

    if (!chat.messagesChatChannelMap.has($scope.channel.name)) {
      chat.messagesChatChannelMap.put($scope.channel.name, [])
    }
    $scope.chatLog = chat.messagesChatChannelMap.get($scope.channel.name)

    $scope.sendChat = function(text) {
      if (!$scope.chatForm.$valid) return
      chat.sendChat($scope.channel.name, $scope.chatMsg)
      $scope.chatMsg = ''
      $scope.chatForm.$setPristine(true)
    }

    $scope.hideChatChannel = function() {
      $scope.minimized = true
    }

    $scope.leaveChatChannel = function() {
      chat.leave($scope.channel.name)
    }

    $scope.toggleChatChannel = function() {
      $scope.minimized = !$scope.minimized
    }
  }

  return {
    restrict: 'E',
    scope: {
      channel: '='
    },
    controller: controller,
    templateUrl: '/partials/chatView'
  }
})