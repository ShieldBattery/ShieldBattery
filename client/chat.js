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

mod.factory('chat', function(siteSocket) {
  return new ChatService(siteSocket)
})

function ChatService(siteSocket) {
  this.siteSocket = siteSocket
  this.joinedChatChannels = []
  this.messagesChatChannelMap = new SimpleMap()
  this.chatChannel = null
  this.currentChatChannel = null
  this.showChatChannel = false

  this._onMessage = this._onMessage.bind(this)
}

ChatService.prototype.create = function(chatChannelName) {
  var self = this
  this.siteSocket.call('/chat/create', { name: chatChannelName }, function(err) {
    self.siteSocket.call('/chat/' + encodeURIComponent(chatChannelName) + '/join',
        { name: chatChannelName }, function(err) {
      self.siteSocket.subscribe('/chat/' + encodeURIComponent(chatChannelName), self._onMessage,
          subscribeCb)

      function subscribeCb(err) {
        if (err) {
          console.log('error joining: ' + err.details.msg)
          // TODO(2Pac): Clean up
        }

        if (!self.chatChannel) {
          self.chatChannel = {}
        }
        self.chatChannel.name = chatChannelName
      }

      self.joinedChatChannels.push(chatChannelName)
    })
  })
}

ChatService.prototype.sendChat = function(chatChannelName, msg) {
  this.siteSocket.publish('/chat/' + encodeURIComponent(chatChannelName),
      { action: 'chat', channel: chatChannelName, text: msg })
}

ChatService.prototype.leave = function(chatChannelName) {
  this.siteSocket.unsubscribe('/chat/' + encodeURIComponent(chatChannelName), this._onMessage)
  this.siteSocket.call('/chat/' + encodeURIComponent(chatChannelName) + '/part')
  var index = this.joinedChatChannels.indexOf(chatChannelName)
  if (index > -1) {
    this.joinedChatChannels.splice(index, 1)
    if (this.joinedChatChannels.length < 1) {
      this.showChatChannel = false
      this.currentChatChannel = null
      return
    }
    if (!this.joinedChatChannels[index - 1]) {
      this.currentChatChannel = this.joinedChatChannels[index]
      return
    }
    this.currentChatChannel = this.joinedChatChannels[index - 1]
  }
}

ChatService.prototype._onMessage = function(data) {
  switch(data.action) {
    case 'update': this._onFullUpdate(data.chatChannel); break
    case 'join': this._onJoin(data.user); break
    case 'part': this._onPart(data.user); break
    case 'chat': this._onChat(data.channel, data.from, data.text); break
    default: console.log('Unknown chat action: ' + data.action); break
  }
}

ChatService.prototype._onFullUpdate = function(chatChannelData) {
  var self = this
  Object.keys(chatChannelData).forEach(function(key) {
    self.chatChannel[key] = chatChannelData[key]
  })
}

ChatService.prototype._onJoin = function(user) {
  if (!this.chatChannel) return
  
  this.chatChannel.users.push(user)

  var log = this.messagesChatChannelMap.get(this.chatChannel.name)
  if (!log) {
    log = []
    this.messagesChatChannelMap.put(this.chatChannel.name, log)
  }
  log.push({ system: true, text: user + ' has joined the channel' })
}

ChatService.prototype._onPart = function(user) {
  if (!this.chatChannel) return

  var index = this.chatChannel.users.indexOf(user)
  if (index > -1) {
    this.chatChannel.users.splice(index, 1)
  }

  var log = this.messagesChatChannelMap.get(this.chatChannel.name)
  if (!log) {
    log = []
    this.messagesChatChannelMap.put(this.chatChannel.name, log)
  }
  log.push({ system: true, text: user + ' has left the channel' })
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
    if (!$scope.joinChatForm.$valid || chat.joinedChatChannels.indexOf(chatChannelName) != -1) {
      $scope.chatChannelName = ''
      $scope.joinChatForm.$setPristine(true)
      return
    }
    chat.create(chatChannelName)
    chat.showChatChannel = true
    chat.currentChatChannel = chatChannelName
    $scope.chatChannelName = ''
    $scope.joinChatForm.$setPristine(true)
  }
})

mod.controller('ChatBarCtrl', function($scope, chat) {
  $scope.chat = chat

  $scope.toggleChannel = function(chatChannelName) {
    chat.showChatChannel = true
    chat.currentChatChannel = chatChannelName
  }
})

mod.controller('ChatViewCtrl', function($scope, chat) {
  $scope.chat = chat

  $scope.$watch('chat.currentChatChannel', function () {
    $scope.refreshChannel()
  })

  $scope.refreshChannel = function() {
    if (!chat.currentChatChannel) {
      return
    } else {
      if (!chat.messagesChatChannelMap.has(chat.currentChatChannel)) {
        chat.messagesChatChannelMap.put(chat.currentChatChannel, [])
      }
      $scope.chatLog = chat.messagesChatChannelMap.get(chat.currentChatChannel)
    }
  }

  $scope.sendChat = function(text) {
    if (!$scope.chatForm.$valid) return
    chat.sendChat(chat.currentChatChannel, $scope.chatMsg)
    $scope.chatMsg = ''
    $scope.chatForm.$setPristine(true)
  }

  $scope.hideChatChannel = function() {
    chat.showChatChannel = false
  }

  $scope.leaveChatChannel = function() {
    chat.leave(chat.currentChatChannel)
  }
})