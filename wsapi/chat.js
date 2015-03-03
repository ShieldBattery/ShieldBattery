var Emitter = require('events').EventEmitter
  , SimpleMap = require('../shared/simple-map')
  , util = require('util')

module.exports = function(nydus, userSockets) {
  return new ChatHandler(nydus, userSockets)
}

function ChatHandler(nydus, userSockets) {
  this.nydus = nydus
  this.userSockets = userSockets
  this.chatChannelMap = new SimpleMap()
  this.userChatChannelsMap = new SimpleMap()

  var self = this
    , basePath = '/chat'
  nydus.router.call(basePath + '/create', function(req, res, params) {
    self.create(req, res, params)
  }).call(basePath + '/:chatChannel/join', function(req, res, params) {
    self.join(req, res, params)
  }).call(basePath + '/:chatChannel/part/:userName', function(req, res) {
    self.part(req, res)
  }).subscribe(basePath + '/:chatChannel', function(req, res) {
    self.subscribeChatChannel(req, res)
  }).publish(basePath + '/:chatChannel', function(req, event, complete) {
    self.sendChat(req, event, complete)
  })
}

ChatHandler.prototype.create = function(req, res, params) {
  if (!params.name) {
    return res.fail(400, 'bad request', { msg: 'Invalid name' })
  }

  if (this.chatChannelMap.has(params.name)) {
    // Chat channel with that name already exists
    // This should fail in future, but for now we're using the same input box for creating/joining
    return res.complete()
  }

  var chatChannel = new ChatChannel(params.name)
  this.chatChannelMap.put(chatChannel.name, chatChannel)

  var self = this
  chatChannel.on('addUser', function onAddUser(userName) {
    var chatChannels = self.userChatChannelsMap.get(userName)
    if (!chatChannels) {
      chatChannels = []
      console.log('addUser1')
      self.userChatChannelsMap.put(userName, chatChannels)
    }
    console.log('adding ' + userName + ' to ' + chatChannel.name)
    chatChannels.push(chatChannel)
    self.nydus.publish(chatChannel._topic, { action: 'join', chatChannelName: params.name,
        user: userName })
    var user = self.userSockets.get(userName)
    user.once('disconnect', onDisconnect)
      .on('subscribe', publishLobby)
      .publish('chatChannel', { name: params.name })
  }).on('removeUser', function onRemoveUser(chatChannelName, userName) {
    var chatChannels = self.userChatChannelsMap.get(userName)
    console.log('removeUser1')
    for (var i = 0; i < chatChannels.length; i++) {
      if (chatChannels[i].name == chatChannelName) {
        console.log('removing ' + chatChannels[i].name)
        chatChannels.splice(i, 1)
        if (chatChannels.length < 1) {
          console.log('removeUser2')
          self.userChatChannelsMap.del(userName)
        }
      }
    }
    var user = self.userSockets.get(userName)
    if (user) {
      user.removeListener('disconnect', onDisconnect)
        .removeListener('subscribe', publishLobby)
      // ensure they receive the part message, then revoke all subscriptions so they can't spy on
      // chat channels they're not in
      process.nextTick(function() {
        user.revoke(chatChannel._topic)
      })
    }
    self.nydus.publish(chatChannel._topic, { action: 'part', name: params.name, user: userName })
  }).on('closed', function onChatChannelClosed() {
    self.chatChannelMap.del(chatChannel.name)
  })

  var user = req.socket.handshake.userName
  chatChannel.addUser(user)

  function onDisconnect() {
    chatChannel.removeUser(this.userName)
  }

  function publishLobby(user, socket) {
    user.publishTo(socket, 'chatChannel', { name: params.name })
  }

  res.complete()
}

ChatHandler.prototype.join = function(req, res, params) {
  var user = req.socket.handshake.userName
  if (!params.name) {
    return res.fail(400, 'bad request', { msg: 'Invalid name' })
  } else if (this.userChatChannelsMap.has(user)) {
    console.log('join1')
    var oldChatChannels = this.userChatChannelsMap.get(user)
    for (var i = 0; i < oldChatChannels.length; i++) {
      if (oldChatChannels[i].name == params.name) {
        console.log('join2')
        return res.complete(user)
      }
    }
  }

  console.log('join3')
  var chatChannel = this.chatChannelMap.get(params.name)
  chatChannel.addUser(user)
  res.complete(user)
}

ChatHandler.prototype.subscribeChatChannel = function(req, res) {
  var user = req.socket.handshake.userName
  if (!req.params.chatChannel || !this.chatChannelMap.has(req.params.chatChannel)) {
    return res.fail(404, 'not found', { msg: 'No chat channel with that name exists' })
  }
  if (!this.userChatChannelsMap.has(user)) {
    return res.fail(403, 'forbidden', { msg: 'You must be in a chat channel to subscribe to it' })
  }

  var chatChannel = this.chatChannelMap.get(req.params.chatChannel)
    , chatChannels = this.userChatChannelsMap.get(user)
    , tempChatChannels = []
  for (var i = 0; i < chatChannels.length; i++) {
    tempChatChannels.push(chatChannels[i].name)
  }

  if (tempChatChannels.indexOf(req.params.chatChannel) < 0) {
    return res.fail(403, 'forbidden', { msg: 'You must be in a chat channel to subscribe to it' })
  }

  res.complete()
  this.nydus.publish(chatChannel._topic, {
    action: 'update', chatChannel: chatChannel.getFullDescription() })
}

ChatHandler.prototype.part = function(req, res) {
  var user = req.socket.handshake.userName
  if (!this.userChatChannelsMap.has(user)) {
    console.log('error 1')
    return res.fail(409, 'conflict', { msg: 'You are not currently in a channel' })
  }

  var chatChannels = this.userChatChannelsMap.get(user)
    , tempChatChannels = []
  for (var i = 0; i < chatChannels.length; i++) {
    tempChatChannels.push(chatChannels[i].name)
  }

  if (tempChatChannels.indexOf(req.params.chatChannel) < 0) {
    console.log('error 2')
    return res.fail(403, 'forbidden', { msg: 'You cannot leave a chat channel you are not in' })
  }

  for (i = 0; i < chatChannels.length; i++) {
    if (chatChannels[i].name == req.params.chatChannel) {
      console.log('removing ' + req.params.userName + ' from ' + chatChannels[i].name)
      chatChannels[i].removeUser(req.params.userName)
    }
  }
  res.complete()
}

ChatHandler.prototype.sendChat = function(req, event, complete) {
  var user = req.socket.handshake.userName
  if (event.action != 'chat' || event.channel === undefined || event.text === undefined) {
    return
  }

  complete({ action: 'chat', channel: event.channel, from: user, text: event.text })
}

function ChatChannel(name) {
  Emitter.call(this)
  this.name = name
  this.users = []
  this._topic = '/chat/' + encodeURIComponent(this.name)
}
util.inherits(ChatChannel, Emitter)

ChatChannel.prototype.addUser = function(user) {
  this.users.push(user)
  this.emit('addUser', user)
}

ChatChannel.prototype.removeUser = function(user) {
  var index = this.users.indexOf(user)
  if (index > -1) {
    this.users.splice(index, 1)
    this.emit('removeUser', this.name, user)
  }
  if (this.users.length < 1) {
    // chat channel is empty, close it down
    this.emit('closed')
  }
}

ChatChannel.prototype.getFullDescription = function() {
  return { name: this.name
         , users: this.users
         }
}