import session from 'koa-generic-session'
import redisStore from 'koa-redis'
import cuid from 'cuid'
import redis from '../redis'
import config from '../../config'

export default session({
  key: 's',
  store: redisStore({ client: redis }),
  cookie: {
    secure: !!config.https,
    maxAge: config.sessionTtl * 1000,
  },
  rolling: true,
  genSid: () => cuid()
})
