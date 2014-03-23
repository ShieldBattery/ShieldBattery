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
