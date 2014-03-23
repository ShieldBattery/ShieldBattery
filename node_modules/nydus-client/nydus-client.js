(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);throw new Error("Cannot find module '"+o+"'")}var f=n[o]={exports:{}};t[o][0].call(f.exports,function(e){var n=t[o][1][e];return s(n?n:e)},f,f.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
var Socket = require('./socket')
  , EventEmitter = require('events').EventEmitter
  , inherits = require('inherits')
  , protocol = require('nydus-protocol')
  , idgen = require('idgen')
  , Backo = require('backo')
  , createRouter = require('./router')

module.exports = function(host) {
  return new NydusClient(host)
}

NydusClient.WELCOME_TIMEOUT = 25000

NydusClient.defaults =  { pingTimeout: 60000
                        , maxReconnectAttempts: -1
                        }

function NydusClient(host, options) {
  EventEmitter.call(this)
  this.socket = new Socket(host)
  this.socket.open()
  this.readyState = 'connecting'
  this.router = createRouter()
  this._forcedDisconnect = false

  this._options = options || {}
  for (var key in NydusClient.defaults) {
    if (typeof this._options[key] == 'undefined') {
      this._options[key] = NydusClient.defaults[key]
    }
  }

  this._backo = new Backo({ min: 100
                          , max: 400000
                          , jitter: 100
                          , factor: 4
                          })
  this._reconnectAttempts = 0
  this._setupPong()

  this._outstandingReqs = Object.create(null)
  this._subscriptions = Object.create(null)

  this.socket.on('connect', this._onConnect.bind(this))
    .on('disconnect', this._onDisconnect.bind(this))
    .on('error', this._onError.bind(this))
    .on('message:call', this._onCallMessage.bind(this))
    .on('message:result', this._onResultMessage.bind(this))
    .on('message:error', this._onErrorMessage.bind(this))
    .on('message:subscribe', this._onSubscribeMessage.bind(this))
    .on('message:unsubscribe', this._onUnsubscribeMessage.bind(this))
    .on('message:publish', this._onPublishMessage.bind(this))
    .on('message:event', this._onEventMessage.bind(this))

}
inherits(NydusClient, EventEmitter)

// call('/my/path', params..., function(err, results...) { })
NydusClient.prototype.call = function(path, params, cb) {
  if (this.readyState != 'connected') {
    var args = arguments
      , self = this
    this.once('connect', function() {
      self.call.apply(self, args)
    })
    return
  }

  var message = { type: protocol.CALL
                , requestId: this._getRequestId()
                , procPath: path
                }
    , callback = arguments.length > 1 ? arguments[arguments.length - 1] : function() {}
    , callParams = Array.prototype.slice.call(arguments, 1, arguments.length - 1)
  if (typeof callback != 'function') {
    callback = function() {}
    callParams.push(arguments[arguments.length - 1])
  }
  message.params = callParams
  this._outstandingReqs[message.requestId] = callback
  this.socket.sendMessage(message)
}

// subscribe('/my/path', function(event) { }, function(err) { })
NydusClient.prototype.subscribe = function(path, listener, cb) {
  var self = this
  if (this.readyState != 'connected') {
    this.once('connect', function() {
      self.subscribe.apply(self, arguments)
    })
    return
  }

  var message = { type: protocol.SUBSCRIBE
                , requestId: this._getRequestId()
                , topicPath: path
                }
    , callback = arguments.length > 2 ? cb : function() {}
  this._outstandingReqs[message.requestId] = function(err) {
    if (err) {
      // TODO(tec27): emit an error if no callback is set?
      return callback.apply(this, arguments)
    }

    if (!self._subscriptions[path]) {
      self._subscriptions[path] = [ listener ]
    } else {
      self._subscriptions[path].push(listener)
    }

    callback.apply(this, arguments)
  }
  this.socket.sendMessage(message)
}

// unsubscribe('/my/path', function(event) { }, function(err) { })
NydusClient.prototype.unsubscribe = function(path, listener, cb) {
  var self = this
  // TODO(tec27): handle cases where we aren't connected yet? Probably need to rework how the
  // similar handling works for subscribe to make that possible
  if (!self._subscriptions[path]) {
    throw new Error('No subscriptions exist for ' + path)
  }
  var index = self._subscriptions[path].indexOf(listener)
  if (index == -1) {
    throw new Error('The specified listener is not currently subscribed to ' + path)
  }

  var message = { type: protocol.UNSUBSCRIBE
                , requestId: this._getRequestId()
                , topicPath: path
                }
    , callback = arguments.length > 2 ? cb : function() {}
  this._outstandingReqs[message.requestId] = function(err) {
    if (err) {
      // TODO(tec27): emit an error if no callback is set?
      return callback.apply(this, arguments)
    }

    self._subscriptions[path].splice(index, 1)
    callback.apply(this, arguments)
  }
  this.socket.sendMessage(message)
}

// publish('/my/path', ..., [ excludeMe ])
NydusClient.prototype.publish = function(path, event, excludeMe) {
  var message = { type: protocol.PUBLISH
                , topicPath: path
                , event: event
                , excludeMe: excludeMe
                }
  this.socket.sendMessage(message)
}

NydusClient.prototype._getRequestId = function() {
  return idgen(16)
}

NydusClient.prototype._onConnect = function() {
  var self = this
  this._reconnectAttempts = 0
  this._backo.reset()
  this.socket.once('message:welcome', onWelcome)
    .once('disconnect', onDisconnect)

  var timeout = setTimeout(function() {
    self.socket.removeListener('message:welcome', onWelcome)
    this.forcedDisconnect = true
    self.socket.close()
    self.emit('error', new Error('Server did not send a WELCOME on connect'))
  }, NydusClient.WELCOME_TIMEOUT)

  function onWelcome(message) {
    clearTimeout(timeout)
    self.socket.removeListener('disconnect', onDisconnect)
    if (message.protocolVersion != protocol.protocolVersion) {
      this._forcedDisconnect = true
      self.socket.close()
      self.emit('error', new Error('Server is using an unsupported protocol version: ' +
          message.protocolVersion))
    } else {
      self._resetPingTimeout()
      self.readyState = 'connected'
      self.emit('connect')
    }
  }

  function onDisconnect(message) {
    clearTimeout(timeout)
    self.socket.removeListener('message:welcome', onWelcome)
  }
}

NydusClient.prototype._onError = function(err) {
  this.emit('error', err)
}

NydusClient.prototype._onDisconnect = function(event) {
  if (typeof this._pingTimeout != 'undefined') {
    clearTimeout(this._pingTimeout)
    delete this._pingTimeout
  }

  if (event && event.code == 4001) {
    this.emit('error', new Error('Unauthorized'))
  }

  this.readyState = 'disconnected'
  this.emit('disconnect')

  // TODO(tec27): maybe automatically resubscribe on reconnect instead?
  this._outstandingReqs = Object.create(null)
  this._subscriptions = Object.create(null)

  var shouldReconnect = !this._forcedDisconnect && (event && event.code != 4001)
  if (shouldReconnect) {
    this._attemptReconnect()
  }
  this._forcedDisconnect = false
}

NydusClient.prototype._attemptReconnect = function() {
  if (this._options.maxReconnectAttempts > 0 &&
      this._reconnectAttempts > this._options.maxReconnectAttempts) {
    return
  }

  this.reconnectAttempts++

  var self = this
  setTimeout(function() {
    self.socket.open()
  }, this._backo.duration())
}

NydusClient.prototype._onCallMessage = function(message) {
  var self = this
    , route = this.router.matchCall(message.procPath)
    , sent = false
  if (!route) {
    var response =  { type: protocol.ERROR
                    , requestId: message.requestId
                    , errorCode: 404
                    , errorDesc: 'not found'
                    , errorDetails: message.procPath + ' could not be found'
                    }
    return this.socket.sendMessage(response)
  }

  var req = { socket: this._socket
            , requestId: message.requestId
            , route: route.route
            , params: route.params
            , splats: route.splats
            }
    , res = { complete: complete, fail: fail }
    , args = [ req, res ].concat(message.params)

  route.fn.apply(this, args)

  function complete(results) {
    if (sent) {
      self.emit('error', new Error('Only one response can be sent for a CALL.'))
      return
    }
    var args = Array.prototype.slice.apply(arguments)
      , response =  { type: protocol.RESULT
                    , requestId: message.requestId
                    , results: args
                    }
    self.socket.sendMessage(response)
    sent = true
  }

  function fail(errorCode, errorDesc, errorDetails) {
    if (sent) {
      self.emit('error', new Error('Only one response can be sent for a CALL.'))
      return
    }
    var response =  { type: protocol.ERROR
                    , requestId: message.requestId
                    , errorCode: errorCode
                    , errorDesc: errorDesc
                    , errorDetails: errorDetails
                    }
    self.socket.sendMessage(response)
    sent = true
  }
}

NydusClient.prototype._onResultMessage = function(message) {
  var cb = this._outstandingReqs[message.requestId]
  if (!cb) {
    return this.emit('error',
      new Error('Received a result for an unrecognized requestId: ' + message.requestId))
  }
  delete this._outstandingReqs[message.requestId]

  var results = [ null /* err */ ].concat(message.results)
  cb.apply(this, results)
}

NydusClient.prototype._onErrorMessage = function(message) {
  var cb = this._outstandingReqs[message.requestId]
  if (!cb) {
    return this.emit('error',
      new Error('Received an error for an unrecognized requestId: ' + message.requestId))
  }
  delete this._outstandingReqs[message.requestId]

  var err = { code: message.errorCode
            , desc: message.errorDesc
            , details: message.errorDetails
            }
  cb.call(this, err)
}

NydusClient.prototype._onSubscribeMessage = function(message) {
  // We don't support subscribing to clients, so give the server an error
  var reply = { type: protocol.ERROR
              , requestId: message.requestId
              , errorCode: 405
              , errorDesc: 'method not allowed'
              , errorDetails: 'client does not support subscriptions'
              }
  this.socket.sendMessage(reply)
}

NydusClient.prototype._onUnsubscribeMessage = function(message) {
  // We don't support subscribing to clients, so any unsubscribe is also an error
  var reply = { type: protocol.ERROR
              , requestId: message.requestId
              , errorCode: 405
              , errorDesc: 'method not allowed'
              , errorDetails: 'client does not support subscriptions'
              }
  this.socket.sendMessage(reply)
}

NydusClient.prototype._onPublishMessage = function(message) {
  // We don't support publishing events to clients, so drop the message
}

NydusClient.prototype._onEventMessage = function(message) {
  if (!this._subscriptions[message.topicPath]) {
    return
  }

  var listeners = this._subscriptions[message.topicPath]
  for (var i = 0, len = listeners.length; i < len; i++) {
    listeners[i].call(this, message.event)
  }
}

NydusClient.prototype._setupPong = function() {
  var self = this
  this.router.call('/_/ping', function(req, res) {
    res.complete()
    self._resetPingTimeout()
  })
}

NydusClient.prototype._resetPingTimeout = function() {
  if (typeof this._pingTimeout != 'undefined') {
    clearTimeout(this._pingTimeout)
  }

  var self = this
  this._pingTimeout = setTimeout(onTimeout, this._options.pingTimeout)
  function onTimeout() {
    delete self._pingTimeout
    self.socket.close()
  }
}

},{"./router":10,"./socket":11,"backo":2,"events":3,"idgen":4,"inherits":5,"nydus-protocol":6}],2:[function(require,module,exports){

/**
 * Expose `Backoff`.
 */

module.exports = Backoff;

/**
 * Initialize backoff timer with `opts`.
 *
 * - `min` initial timeout in milliseconds [100]
 * - `max` max timeout [10000]
 * - `jitter` [0]
 * - `factor` [2]
 *
 * @param {Object} opts
 * @api public
 */

function Backoff(opts) {
  opts = opts || {};
  this.ms = opts.min || 100;
  this.max = opts.max || 10000;
  this.factor = opts.factor || 2;
  this.jitter = opts.jitter || 0;
  this.attempts = 0;
}

/**
 * Return the backoff duration.
 *
 * @return {Number}
 * @api public
 */

Backoff.prototype.duration = function(){
  var ms = this.ms * Math.pow(this.factor, this.attempts++);
  if (this.jitter) ms += Math.random() * this.jitter;
  return Math.min(ms, this.max) | 0;
};

/**
 * Reset the number of attempts.
 *
 * @api public
 */

Backoff.prototype.reset = function(){
  this.attempts = 0;
};
},{}],3:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

function EventEmitter() {
  this._events = this._events || {};
  this._maxListeners = this._maxListeners || undefined;
}
module.exports = EventEmitter;

// Backwards-compat with node 0.10.x
EventEmitter.EventEmitter = EventEmitter;

EventEmitter.prototype._events = undefined;
EventEmitter.prototype._maxListeners = undefined;

// By default EventEmitters will print a warning if more than 10 listeners are
// added to it. This is a useful default which helps finding memory leaks.
EventEmitter.defaultMaxListeners = 10;

// Obviously not all Emitters should be limited to 10. This function allows
// that to be increased. Set to zero for unlimited.
EventEmitter.prototype.setMaxListeners = function(n) {
  if (!isNumber(n) || n < 0 || isNaN(n))
    throw TypeError('n must be a positive number');
  this._maxListeners = n;
  return this;
};

EventEmitter.prototype.emit = function(type) {
  var er, handler, len, args, i, listeners;

  if (!this._events)
    this._events = {};

  // If there is no 'error' event listener then throw.
  if (type === 'error') {
    if (!this._events.error ||
        (isObject(this._events.error) && !this._events.error.length)) {
      er = arguments[1];
      if (er instanceof Error) {
        throw er; // Unhandled 'error' event
      } else {
        throw TypeError('Uncaught, unspecified "error" event.');
      }
      return false;
    }
  }

  handler = this._events[type];

  if (isUndefined(handler))
    return false;

  if (isFunction(handler)) {
    switch (arguments.length) {
      // fast cases
      case 1:
        handler.call(this);
        break;
      case 2:
        handler.call(this, arguments[1]);
        break;
      case 3:
        handler.call(this, arguments[1], arguments[2]);
        break;
      // slower
      default:
        len = arguments.length;
        args = new Array(len - 1);
        for (i = 1; i < len; i++)
          args[i - 1] = arguments[i];
        handler.apply(this, args);
    }
  } else if (isObject(handler)) {
    len = arguments.length;
    args = new Array(len - 1);
    for (i = 1; i < len; i++)
      args[i - 1] = arguments[i];

    listeners = handler.slice();
    len = listeners.length;
    for (i = 0; i < len; i++)
      listeners[i].apply(this, args);
  }

  return true;
};

EventEmitter.prototype.addListener = function(type, listener) {
  var m;

  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  if (!this._events)
    this._events = {};

  // To avoid recursion in the case that type === "newListener"! Before
  // adding it to the listeners, first emit "newListener".
  if (this._events.newListener)
    this.emit('newListener', type,
              isFunction(listener.listener) ?
              listener.listener : listener);

  if (!this._events[type])
    // Optimize the case of one listener. Don't need the extra array object.
    this._events[type] = listener;
  else if (isObject(this._events[type]))
    // If we've already got an array, just append.
    this._events[type].push(listener);
  else
    // Adding the second element, need to change to array.
    this._events[type] = [this._events[type], listener];

  // Check for listener leak
  if (isObject(this._events[type]) && !this._events[type].warned) {
    var m;
    if (!isUndefined(this._maxListeners)) {
      m = this._maxListeners;
    } else {
      m = EventEmitter.defaultMaxListeners;
    }

    if (m && m > 0 && this._events[type].length > m) {
      this._events[type].warned = true;
      console.error('(node) warning: possible EventEmitter memory ' +
                    'leak detected. %d listeners added. ' +
                    'Use emitter.setMaxListeners() to increase limit.',
                    this._events[type].length);
      console.trace();
    }
  }

  return this;
};

EventEmitter.prototype.on = EventEmitter.prototype.addListener;

EventEmitter.prototype.once = function(type, listener) {
  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  var fired = false;

  function g() {
    this.removeListener(type, g);

    if (!fired) {
      fired = true;
      listener.apply(this, arguments);
    }
  }

  g.listener = listener;
  this.on(type, g);

  return this;
};

// emits a 'removeListener' event iff the listener was removed
EventEmitter.prototype.removeListener = function(type, listener) {
  var list, position, length, i;

  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  if (!this._events || !this._events[type])
    return this;

  list = this._events[type];
  length = list.length;
  position = -1;

  if (list === listener ||
      (isFunction(list.listener) && list.listener === listener)) {
    delete this._events[type];
    if (this._events.removeListener)
      this.emit('removeListener', type, listener);

  } else if (isObject(list)) {
    for (i = length; i-- > 0;) {
      if (list[i] === listener ||
          (list[i].listener && list[i].listener === listener)) {
        position = i;
        break;
      }
    }

    if (position < 0)
      return this;

    if (list.length === 1) {
      list.length = 0;
      delete this._events[type];
    } else {
      list.splice(position, 1);
    }

    if (this._events.removeListener)
      this.emit('removeListener', type, listener);
  }

  return this;
};

EventEmitter.prototype.removeAllListeners = function(type) {
  var key, listeners;

  if (!this._events)
    return this;

  // not listening for removeListener, no need to emit
  if (!this._events.removeListener) {
    if (arguments.length === 0)
      this._events = {};
    else if (this._events[type])
      delete this._events[type];
    return this;
  }

  // emit removeListener for all listeners on all events
  if (arguments.length === 0) {
    for (key in this._events) {
      if (key === 'removeListener') continue;
      this.removeAllListeners(key);
    }
    this.removeAllListeners('removeListener');
    this._events = {};
    return this;
  }

  listeners = this._events[type];

  if (isFunction(listeners)) {
    this.removeListener(type, listeners);
  } else {
    // LIFO order
    while (listeners.length)
      this.removeListener(type, listeners[listeners.length - 1]);
  }
  delete this._events[type];

  return this;
};

EventEmitter.prototype.listeners = function(type) {
  var ret;
  if (!this._events || !this._events[type])
    ret = [];
  else if (isFunction(this._events[type]))
    ret = [this._events[type]];
  else
    ret = this._events[type].slice();
  return ret;
};

EventEmitter.listenerCount = function(emitter, type) {
  var ret;
  if (!emitter._events || !emitter._events[type])
    ret = 0;
  else if (isFunction(emitter._events[type]))
    ret = 1;
  else
    ret = emitter._events[type].length;
  return ret;
};

function isFunction(arg) {
  return typeof arg === 'function';
}

function isNumber(arg) {
  return typeof arg === 'number';
}

function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}

function isUndefined(arg) {
  return arg === void 0;
}

},{}],4:[function(require,module,exports){
/**
 * id generator
 * ------------
 *
 * @exports {Function} id generator function
 */

/**
 * @param [len] {Number} Length of the ID to generate.
 * @return {String} A unique alphanumeric string.
 */
function idgen(len, chars) {
  len || (len = 8);
  chars || (chars = 'ABCDEFGHIJKLMNOPQRSTUVWYXZabcdefghijklmnopqrstuvwyxz0123456789');
  var ret = ''
    , range = chars.length - 1
    , len_left = len
    , idx
    , useTime = len > 15

  if (useTime) var time = String(Date.now());

  while (len_left--) {
    if (useTime && time) {
      idx = Number(time.slice(0, 2)) % range;
      time = time.slice(2);
    }
    else {
      idx = Math.round(Math.random() * range);
    }
    ret += chars.charAt(idx);
  }
  return ret;
};
module.exports = idgen;

function idgen_hex(len) {
  len = len || 16;
  return idgen(len, '0123456789abcdef');
};
module.exports.hex = idgen_hex;

},{}],5:[function(require,module,exports){
if (typeof Object.create === 'function') {
  // implementation from standard node.js 'util' module
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    ctor.prototype = Object.create(superCtor.prototype, {
      constructor: {
        value: ctor,
        enumerable: false,
        writable: true,
        configurable: true
      }
    });
  };
} else {
  // old school shim for old browsers
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    var TempCtor = function () {}
    TempCtor.prototype = superCtor.prototype
    ctor.prototype = new TempCtor()
    ctor.prototype.constructor = ctor
  }
}

},{}],6:[function(require,module,exports){
var debug = require('debug')('nydus-protocol')

exports.TYPES = { WELCOME: 0
                , CALL: 1
                , RESULT: 2
                , ERROR: 3
                , SUBSCRIBE: 4
                , UNSUBSCRIBE: 5
                , PUBLISH: 6
                , EVENT: 7
                }
// Set all the message types directly on the exports as well, for easy access
Object.keys(exports.TYPES).forEach(function(key) {
  exports[key] = exports.TYPES[key]
})

exports.protocolVersion = 1

// Build a lookup which should be faster than an unoptimizable switch
var decoders = []
decoders[exports.WELCOME] = decodeWelcome
decoders[exports.CALL] = decodeCall
decoders[exports.RESULT] = decodeResult
decoders[exports.ERROR] = decodeError
decoders[exports.SUBSCRIBE] = decodeSubscribe
decoders[exports.UNSUBSCRIBE] = decodeUnsubscribe
decoders[exports.PUBLISH] = decodePublish
decoders[exports.EVENT] = decodeEvent

exports.decode = function(str) {
  var parsed = JSON.parse(str)
  if (!Array.isArray(parsed)) {
    throw new Error('parsed string was not an Array')
  } else if (parsed.length < 1) {
    throw new Error('invalid message length')
  }

  var result = {}
  result.type = parsed[0]
  var decodeFunc = decoders[result.type] || invalidType
  decodeFunc(parsed, result)

  debug('decoded %s as %j', str, result)
  return result

  function invalidType() {
    throw new Error('invalid message type: ' + result.type)
  }
}

// Build a lookup which should be faster than an unoptimizable switch
var encoders = []
encoders[exports.WELCOME] = encodeWelcome
encoders[exports.CALL] = encodeCall
encoders[exports.RESULT] = encodeResult
encoders[exports.ERROR] = encodeError
encoders[exports.SUBSCRIBE] = encodeSubscribe
encoders[exports.UNSUBSCRIBE] = encodeUnsubscribe
encoders[exports.PUBLISH] = encodePublish
encoders[exports.EVENT] = encodeEvent
// obj is an object with a type field, and any other type-specific fields (following the same format
// as decoded messages)
exports.encode = function(obj) {
  var result = [ obj.type ]
    , encodeFunc = encoders[obj.type] || invalidType
  encodeFunc(obj, result)

  var json = JSON.stringify(result)
  debug('encoded %j as %s', obj, json)

  return json

  function invalidType() {
    throw new Error('invalid message type: ' + obj.type)
  }
}

function decodeWelcome(parsed, result) {
  // [ WELCOME, protocolVersion, serverAgent ]
  if (parsed.length < 3) {
    throw new Error('invalid WELCOME message length: ' + parsed.length)
  } else if (typeof parsed[1] != 'number') {
    throw new Error('invalid WELCOME message, protocolVersion must be a Number')
  } else if (typeof parsed[2] != 'string') {
    throw new Error('invalid WELCOME message, serverAgent must be a String')
  }

  result.protocolVersion = parsed[1]
  result.serverAgent = parsed[2]
}

function encodeWelcome(obj, result) {
  // [ WELCOME, protocolVersion, serverAgent ]
  // Note that protocolVersion is handled by us, so only a serverAgent needs to be specified
  if (obj.serverAgent == null) {
    throw new Error('incomplete WELCOME object, serverAgent must be specified')
  }

  result.push(exports.protocolVersion)
  result.push('' + obj.serverAgent)
}

function decodeCall(parsed, result) {
  // [ CALL, requestId, procPath, ... ]
  if (parsed.length < 3) {
    throw new Error('invalid CALL message length: ' + parsed.length)
  } else if (typeof parsed[1] != 'string') {
    throw new Error('invalid CALL message, requestId must be a String')
  } else if (typeof parsed[2] != 'string') {
    throw new Error('invalid CALL message, procPath must be a String')
  }

  result.requestId = parsed[1]
  result.procPath = parsed[2]
  if (parsed.length > 3) {
    result.params = parsed.slice(3)
  } else {
    result.params = []
  }
}

function encodeCall(obj, result) {
  // [ CALL, requestId, procPath, params...]
  if (obj.requestId == null) {
    throw new Error('incomplete CALL object, requestId must be specified')
  } else if (obj.procPath == null) {
    throw new Error('incomplete CALL object, procPath must be specified')
  } else if (obj.params != null && !Array.isArray(obj.params)) {
    throw new Error('invalid CALL object, params must be an array if specified')
  }

  result.push('' + obj.requestId)
  result.push('' + obj.procPath)
  var params = obj.params || []
  result.push.apply(result, params)
}

function decodeResult(parsed, result) {
  // [ RESULT, requestId, ... ]
  if (parsed.length < 2) {
    throw new Error('invalid RESULT message length: ' + parsed.length)
  } else if (typeof parsed[1] != 'string') {
    throw new Error('invalid RESULT message, requestId must be a String')
  }

  result.requestId = parsed[1]
  if (parsed.length > 2) {
    result.results = parsed.slice(2)
  } else {
    result.results = []
  }
}

function encodeResult(obj, result) {
  // [ RESULT, requestId, results... ]
  if (obj.requestId == null) {
    throw new Error('incomplete RESULT object, requestId must be specified')
  } else if (obj.results != null && !Array.isArray(obj.results)) {
    throw new Error('invalid RESULT object, results must be an array if specified')
  }

  result.push('' + obj.requestId)
  var resultList = obj.results || []
  result.push.apply(result, resultList)
}

function decodeError(parsed, result) {
  // [ ERROR, requestId, errorCode, errorDesc, errorDetails (optional) ]
  if (parsed.length < 4) {
    throw new Error('invalid ERROR message length: ' + parsed.length)
  } else if (typeof parsed[1] != 'string') {
    throw new Error('invalid ERROR message, requestId must be a String')
  } else if (typeof parsed[2] != 'number') {
    throw new Error('invalid ERROR message, errorCode must be a Number')
  } else if (typeof parsed[3] != 'string') {
    throw new Error('invalid ERROR message, errorDesc must be a String')
  }

  result.requestId = parsed[1]
  result.errorCode = parsed[2]
  result.errorDesc = parsed[3]
  if (parsed.length >= 5) {
    result.errorDetails = parsed[4]
  }
}

function encodeError(obj, result) {
  // [ ERROR, requestId, errorCode, errorDesc, errorDetails (optional) ]
  if (obj.requestId == null) {
    throw new Error('incomplete ERROR object, requestId must be specified')
  } else if (obj.errorCode == null) {
    throw new Error('incomplete ERROR object, errorCode must be specified')
  } else if (obj.errorDesc == null) {
    throw new Error('incomplete ERROR object, errorDesc must be specified')
  }

  var errorCode = +obj.errorCode
  if (Number.isNaN(errorCode)) {
    throw new Error('invalid ERROR object, errorCode must be numeric')
  }

  result.push('' + obj.requestId)
  result.push(errorCode)
  result.push('' + obj.errorDesc)
  if (typeof obj.errorDetails != 'undefined') {
    result.push(obj.errorDetails)
  }
}

function decodeSubscribe(parsed, result) {
  // [ SUBSCRIBE, requestId, topicPath ]
  if (parsed.length < 3) {
    throw new Error('invalid SUBSCRIBE message length: ' + parsed.length)
  } else if (typeof parsed[1] != 'string') {
    throw new Error('invalid SUBSCRIBE message, requestId must be a String')
  } else if (typeof parsed[2] != 'string') {
    throw new Error('invalid SUBSCRIBE message, topicPath must be a String')
  }

  result.requestId = parsed[1]
  result.topicPath = parsed[2]
}

function encodeSubscribe(obj, result) {
  // [ SUBSCRIBE, requestId, topicPath ]
  if (obj.requestId == null) {
    throw new Error('incomplete SUBSCRIBE object, requestId must be specified')
  } else if (obj.topicPath == null) {
    throw new Error('incomplete SUBSCRIBE object, topicPath must be specified')
  }

  result.push('' + obj.requestId)
  result.push('' + obj.topicPath)
}

function decodeUnsubscribe(parsed, result) {
  // [ UNSUBSCRIBE, requestId, topicPath ]
  if (parsed.length < 3) {
    throw new Error('invalid UNSUBSCRIBE message length: ' + parsed.length)
  } else if (typeof parsed[1] != 'string') {
    throw new Error('invalid UNSUBSCRIBE message, requestId must be a String')
  } else if (typeof parsed[2] != 'string') {
    throw new Error('invalid UNSUBSCRIBE message, topicPath must be a String')
  }

  result.requestId = parsed[1]
  result.topicPath = parsed[2]
}

function encodeUnsubscribe(obj, result) {
  // [ UNSUBSCRIBE, requestId, topicPath ]
  if (obj.requestId == null) {
    throw new Error('incomplete UNSUBSCRIBE object, requestId must be specified')
  } else if (obj.topicPath == null) {
    throw new Error('incomplete UNSUBSCRIBE object, topicPath must be specified')
  }

  result.push('' + obj.requestId)
  result.push('' + obj.topicPath)
}

function decodePublish(parsed, result) {
  // [ PUBLISH, topicPath, event, excludeMe (optional, defaults to false) ]
  if (parsed.length < 3) {
    throw new Error('invalid PUBLISH message length: ' + parsed.length)
  } else if (typeof parsed[1] != 'string') {
    throw new Error('invalid PUBLISH message, topicPath must be a String')
  } else if (parsed.length > 3 && typeof parsed[3] != 'boolean') {
    throw new Error('invalid PUBLISH message, excludeMe must be a Boolean')
  }

  result.topicPath = parsed[1]
  result.event = parsed[2]
  result.excludeMe = parsed.length > 3 ? parsed[3] : false
}

function encodePublish(obj, result) {
  // [ PUBLISH, topicPath, event, excludeMe (optional, defaults to false) ]
  if (obj.topicPath == null) {
    throw new Error('incomplete PUBLISH object, topicPath must be specified')
  } else if (typeof obj.event == 'undefined') {
    throw new Error('incomplete PUBLISH object, event must be specified')
  }

  result.push('' + obj.topicPath)
  result.push(obj.event)
  var exclude = !!obj.excludeMe
  if (exclude) {
    result.push(exclude)
  }
}

function decodeEvent(parsed, result) {
  // [ EVENT, topicPath, event ]
  if (parsed.length < 3) {
    throw new Error('invalid EVENT message length: ' + parsed.length)
  } else if (typeof parsed[1] != 'string') {
    throw new Error('invalid EVENT message, topicPath must be a String')
  }

  result.topicPath = parsed[1]
  result.event = parsed[2]
}

function encodeEvent(obj, result) {
  // [ EVENT, topicPath, event ]
  if (obj.topicPath == null) {
    throw new Error('incomplete EVENT object, topicPath must be specified')
  } else if (typeof obj.event == 'undefined') {
    throw new Error('incomplete EVENT object, event must be specified')
  }

  result.push('' + obj.topicPath)
  result.push(obj.event)
}

},{"debug":7}],7:[function(require,module,exports){

/**
 * Expose `debug()` as the module.
 */

module.exports = debug;

/**
 * Create a debugger with the given `name`.
 *
 * @param {String} name
 * @return {Type}
 * @api public
 */

function debug(name) {
  if (!debug.enabled(name)) return function(){};

  return function(fmt){
    fmt = coerce(fmt);

    var curr = new Date;
    var ms = curr - (debug[name] || curr);
    debug[name] = curr;

    fmt = name
      + ' '
      + fmt
      + ' +' + debug.humanize(ms);

    // This hackery is required for IE8
    // where `console.log` doesn't have 'apply'
    window.console
      && console.log
      && Function.prototype.apply.call(console.log, console, arguments);
  }
}

/**
 * The currently active debug mode names.
 */

debug.names = [];
debug.skips = [];

/**
 * Enables a debug mode by name. This can include modes
 * separated by a colon and wildcards.
 *
 * @param {String} name
 * @api public
 */

debug.enable = function(name) {
  try {
    localStorage.debug = name;
  } catch(e){}

  var split = (name || '').split(/[\s,]+/)
    , len = split.length;

  for (var i = 0; i < len; i++) {
    name = split[i].replace('*', '.*?');
    if (name[0] === '-') {
      debug.skips.push(new RegExp('^' + name.substr(1) + '$'));
    }
    else {
      debug.names.push(new RegExp('^' + name + '$'));
    }
  }
};

/**
 * Disable debug output.
 *
 * @api public
 */

debug.disable = function(){
  debug.enable('');
};

/**
 * Humanize the given `ms`.
 *
 * @param {Number} m
 * @return {String}
 * @api private
 */

debug.humanize = function(ms) {
  var sec = 1000
    , min = 60 * 1000
    , hour = 60 * min;

  if (ms >= hour) return (ms / hour).toFixed(1) + 'h';
  if (ms >= min) return (ms / min).toFixed(1) + 'm';
  if (ms >= sec) return (ms / sec | 0) + 's';
  return ms + 'ms';
};

/**
 * Returns true if the given mode name is enabled, false otherwise.
 *
 * @param {String} name
 * @return {Boolean}
 * @api public
 */

debug.enabled = function(name) {
  for (var i = 0, len = debug.skips.length; i < len; i++) {
    if (debug.skips[i].test(name)) {
      return false;
    }
  }
  for (var i = 0, len = debug.names.length; i < len; i++) {
    if (debug.names[i].test(name)) {
      return true;
    }
  }
  return false;
};

/**
 * Coerce `val`.
 */

function coerce(val) {
  if (val instanceof Error) return val.stack || val.message;
  return val;
}

// persist

try {
  if (window.localStorage) debug.enable(localStorage.debug);
} catch(e){}

},{}],8:[function(require,module,exports){

var localRoutes = [];


/**
 * Convert path to route object
 *
 * A string or RegExp should be passed,
 * will return { re, src, keys} obj
 *
 * @param  {String / RegExp} path
 * @return {Object}
 */
 
var Route = function(path){
  //using 'new' is optional
  
  var src, re, keys = [];
  
  if(path instanceof RegExp){
    re = path;
    src = path.toString();
  }else{
    re = pathToRegExp(path, keys);
    src = path;
  }

  return {
  	 re: re,
  	 src: path.toString(),
  	 keys: keys
  }
};

/**
 * Normalize the given path string,
 * returning a regular expression.
 *
 * An empty array should be passed,
 * which will contain the placeholder
 * key names. For example "/user/:id" will
 * then contain ["id"].
 *
 * @param  {String} path
 * @param  {Array} keys
 * @return {RegExp}
 */
var pathToRegExp = function (path, keys) {
	path = path
		.concat('/?')
		.replace(/\/\(/g, '(?:/')
		.replace(/(\/)?(\.)?:(\w+)(?:(\(.*?\)))?(\?)?/g, function(_, slash, format, key, capture, optional){
			keys.push(key);
			slash = slash || '';
			return ''
				+ (optional ? '' : slash)
				+ '(?:'
				+ (optional ? slash : '')
				+ (format || '') + (capture || '([^/]+?)') + ')'
				+ (optional || '');
		})
		.replace(/([\/.])/g, '\\$1')
		.replace(/\*/g, '(.+)');
	return new RegExp('^' + path + '$', 'i');
};

/**
 * Attempt to match the given request to
 * one of the routes. When successful
 * a  {fn, params, splats} obj is returned
 *
 * @param  {Array} routes
 * @param  {String} uri
 * @return {Object}
 */
var match = function (routes, uri) {
	var captures, i = 0;

	for (var len = routes.length; i < len; ++i) {
		var route = routes[i],
		    re = route.re,
		    keys = route.keys,
		    splats = [],
		    params = {};

		if (captures = re.exec(uri)) {
			for (var j = 1, len = captures.length; j < len; ++j) {
				var key = keys[j-1],
					val = typeof captures[j] === 'string'
						? decodeURIComponent(captures[j])
						: captures[j];
				if (key) {
					params[key] = val;
				} else {
					splats.push(val);
				}
			}
			return {
				params: params,
				splats: splats,
				route: route.src
			};
		}
	}
};

/**
 * Default "normal" router constructor.
 * accepts path, fn tuples via addRoute
 * returns {fn, params, splats, route}
 *  via match
 *
 * @return {Object}
 */
 
var Router = function(){
  //using 'new' is optional
  return {
    routes: [],
    routeMap : {},
    addRoute: function(path, fn){
      if (!path) throw new Error(' route requires a path');
      if (!fn) throw new Error(' route ' + path.toString() + ' requires a callback');

      var route = Route(path);
      route.fn = fn;

      this.routes.push(route);
      this.routeMap[path] = fn;
    },

    match: function(pathname){
      var route = match(this.routes, pathname);
      if(route){
        route.fn = this.routeMap[route.route];
      }
      return route;
    }
  }
};

Router.Route = Route
Router.pathToRegExp = pathToRegExp
Router.match = match
// back compat
Router.Router = Router

module.exports = Router

},{}],9:[function(require,module,exports){

/**
 * Module dependencies.
 */

var global = (function() { return this; })();

/**
 * WebSocket constructor.
 */

var WebSocket = global.WebSocket || global.MozWebSocket;

/**
 * Module exports.
 */

module.exports = WebSocket ? ws : null;

/**
 * WebSocket constructor.
 *
 * The third `opts` options object gets ignored in web browsers, since it's
 * non-standard, and throws a TypeError if passed to the constructor.
 * See: https://github.com/einaros/ws/issues/227
 *
 * @param {String} uri
 * @param {Array} protocols (optional)
 * @param {Object) opts (optional)
 * @api public
 */

function ws(uri, protocols, opts) {
  var instance;
  if (protocols) {
    instance = new WebSocket(uri, protocols);
  } else {
    instance = new WebSocket(uri);
  }
  return instance;
}

if (WebSocket) ws.prototype = WebSocket.prototype;

},{}],10:[function(require,module,exports){
var Router = require('routes')

module.exports = function() {
  return new NydusClientRouter()
}

function NydusClientRouter() {
  this._callRouter = new Router()
}

NydusClientRouter.prototype.call = function(path, fn) {
  this._callRouter.addRoute(path, fn)
  return this
}

NydusClientRouter.prototype.matchCall = function(path) {
  return this._callRouter.match(path)
}

},{"routes":8}],11:[function(require,module,exports){
var WS = require('ws')
  , EventEmitter = require('events').EventEmitter
  , inherits = require('inherits')
  , protocol = require('nydus-protocol')

module.exports = Socket

function Socket(host) {
  EventEmitter.call(this)
  this._host = host
}
inherits(Socket, EventEmitter)

Socket.prototype.open = function() {
  if (!WS) {
    throw new Error('WebSockets are not supported')
  }

  if (!this._ws || this._ws.readyState >= WebSocket.CLOSING) {
    this._ws = new WS(this._host)
    this._ws.onopen = this._onOpen.bind(this)
    this._ws.onclose = this._onClose.bind(this)
    this._ws.onerror = this._onError.bind(this)
    this._ws.onmessage = this._onMessage.bind(this)
  }

  return this
}

Socket.prototype.close = function() {
  if (this._ws && this._ws.readyState < WebSocket.CLOSING) {
    this._ws.close()
  }

  return this
}

Socket.prototype._onOpen = function() {
  this.emit('connect')
}

Socket.prototype._onClose = function(event) {
  this.emit('disconnect', event)
}

Socket.prototype._onError = function(event) {
  this.emit('error', event)
}

Socket.prototype._onMessage = function(event) {
  try {
    var message = protocol.decode(event.data)
  } catch (err) {
    this._ws.close(1002, 'Invalid nydus message')
    this.emit('error', err)
    return
  }

  this.emit('message', message)
  switch (message.type) {
    case protocol.WELCOME:
      this.emit('message:welcome', message)
      break
    case protocol.CALL:
      this.emit('message:call', message)
      break
    case protocol.RESULT:
      this.emit('message:result', message)
      break
    case protocol.ERROR:
      this.emit('message:error', message)
      break
    case protocol.SUBSCRIBE:
      this.emit('message:subscribe', message)
      break
    case protocol.UNSUBSCRIBE:
      this.emit('message:unsubscribe', message)
      break
    case protocol.PUBLISH:
      this.emit('message:publish', message)
      break
    case protocol.EVENT:
      this.emit('message:event', message)
      break
  }
}

Socket.prototype.sendMessage = function(message) {
  var encoded = protocol.encode(message)
  this.emit('send', message)
  this._ws.send(encoded)
}

},{"events":3,"inherits":5,"nydus-protocol":6,"ws":9}]},{},[1])