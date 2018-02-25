import session from 'koa-generic-session'
import cuid from 'cuid'
import store from './session-store'
import config from '../../config'

export default session({
  key: 's',
  store,
  cookie: {
    maxAge: config.sessionTtl * 1000,
  },
  rolling: true,
  genSid: () => cuid(),
})
