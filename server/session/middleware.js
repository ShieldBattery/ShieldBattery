var session = require('koa-generic-session')
  , redisStore = require('koa-redis')
  , cuid = require('cuid')
  , redis = require('../redis')
  , config = require('../../config')

module.exports = session({
  key: 's',
  store: redisStore({ client: redis }),
  cookie: {
    secure: !!config.https,
    maxAge: config.sessionTtl * 1000,
  },
  rolling: true,
  genSid: () => cuid()
})
