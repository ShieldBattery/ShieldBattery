var redis = require('redis')
  , config = require('./config')

// TODO(tec27): provide some better wrapper around this that deals with connects/disconnects, etc.
module.exports = redis.createClient(config.redis.port, config.redis.host)
