import session from 'koa-generic-session'
import cuid from 'cuid'
import store from './session-store'

const SESSION_TTL_SECONDS = Number(process.env.SB_SESSION_TTL)

export default session({
  key: 's',
  store,
  cookie: {
    maxAge: SESSION_TTL_SECONDS * 1000,
  },
  rolling: true,
  genSid: () => cuid(),
})
