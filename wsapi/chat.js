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
  this.userChatChannelMap = new SimpleMap()

  var self = this
    , basePath = '/chat'
  nydus.router.call(basePath + '/create', function(req, res, params) {
    self.create(req, res, params)
  }).call(basePath + '/:chatChannel/join', function(req, res, params) {
    self.join(req, res, params)
  }).call(basePath + '/:chatChannel/part', function(req, res) {
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
  chatChannel.on('addUser', function onAddUser(user) {
    self.userChatChannelMap.put(user, chatChannel)
    self.nydus.publish(chatChannel._topic, { action: 'join', user: user })
  }).on('removeUser', function onRemoveUser(user) {
    self.userChatChannelMap.del(user)
    self.nydus.publish(chatChannel._topic, { action: 'part', user: user })
  })

  res.complete()
}

ChatHandler.prototype.join = function(req, res, params) {
  var user = req.socket.handshake.userName
  if (!params.name) {
    return res.fail(400, 'bad request', { msg: 'Invalid name' })
  }

  var chatChannel = this.chatChannelMap.get(params.name)
  chatChannel.addUser(user)
  res.complete()
}

ChatHandler.prototype.subscribeChatChannel = function(req, res) {
  var user = req.socket.handshake.userName
  if (!req.params.chatChannel || !this.chatChannelMap.has(req.params.chatChannel)) {
    return res.fail(404, 'not found', { msg: 'No chat channel with that name exists' })
  }
  if (!this.userChatChannelMap.has(user)) {
    return res.fail(403, 'forbidden', { msg: 'You must be in a chat channel to subscribe to it' })
  }

  var chatChannel = this.chatChannelMap.get(req.params.chatChannel)
  if (this.userChatChannelMap.get(user) != chatChannel) {
    return res.fail(403, 'forbidden', { msg: 'You must be in a chat channel to subscribe to it' })
  }

  res.complete()
  this.nydus.publish(chatChannel._topic, {
    action: 'update', chatChannel: chatChannel.getFullDescription() })
}

ChatHandler.prototype.part = function(req, res) {
  var user = req.socket.handshake.userName
  if (!this.userChatChannelMap.has(user)) {
    return res.fail(409, 'conflict', { msg: 'You are not currently in a channel' })
  }

  var chatChannel = this.userChatChannelMap.get(user)
  if (req.params.chatChannel != chatChannel.name) {
    return res.fail(403, 'forbidden', { msg: 'You cannot leave a chat channel you are not in' })
  }
  chatChannel.removeUser(user)
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
    this.emit('removeUser', user)
  }
}

ChatChannel.prototype.getFullDescription = function() {
  return { name: this.name
         , users: this.users
         }
}