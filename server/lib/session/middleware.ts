import cuid from 'cuid'
import session from 'koa-generic-session'
import { isElectronClient } from '../network/only-web-clients'
import store from './session-store'

const SESSION_TTL_SECONDS = Number(process.env.SB_SESSION_TTL)

export default session({
  key: 's',
  store,
  cookie: {
    maxAge: SESSION_TTL_SECONDS * 1000,
    sameSite: 'lax',
  },
  rolling: true,
  genSid: () => cuid(),
  beforeSave: (ctx, session) => {
    if (isElectronClient(ctx)) {
      // Can't set SameSite: lax cookies on cross-origin requests, which is all requests for the
      // Electron client
      session.cookie.sameSite = 'none'
    }
  },
})
