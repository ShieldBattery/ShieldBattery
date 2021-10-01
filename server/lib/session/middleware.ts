import cuid from 'cuid'
import { Context } from 'koa'
import session, { SessionOptions } from 'koa-generic-session'
import { isElectronClient } from '../network/only-web-clients'
import store from './session-store'

const SESSION_TTL_SECONDS = Number(process.env.SB_SESSION_TTL)

const SESSION_KEY = 's'

// NOTE(tec27): koa-generic-session will write its default options into this object as well
const cookieOptions: SessionOptions['cookie'] = {
  maxAge: SESSION_TTL_SECONDS * 1000,
  sameSite: 'lax',
}

export default session({
  key: SESSION_KEY,
  store,
  cookie: cookieOptions,
  rolling: true,
  genSid: () => cuid(),
  beforeSave: (ctx, session) => {
    if (isElectronClient(ctx)) {
      // Can't set SameSite: lax cookies on cross-origin requests, which is all requests for the
      // Electron client
      session.cookie.sameSite = 'none'
      session.cookie.secure = true
    }
  },
  // This is the default session store except we don't try to set cookies if a handler says not
  // to (usually because it needed to flush the headers prematurely)
  sessionIdStore: {
    get(this: Context) {
      return this.cookies.get(SESSION_KEY, cookieOptions as any)
    },

    set(this: Context, sid, session) {
      if (!this.dontSendSessionCookies) {
        if (isElectronClient(this)) {
          // Force the cookies module to allow secure cookies even on unsecure hosts
          // (e.g. localhost). Chrome will accept/return these fine anyway. This is needed for using
          // same-site = none
          this.cookies.secure = true
        }
        this.cookies.set(SESSION_KEY, sid, session.cookie)
      }
    },

    reset(this: Context) {
      if (!this.dontSendSessionCookies) {
        if (isElectronClient(this)) {
          // Force the cookies module to allow secure cookies even on unsecure hosts
          // (e.g. localhost). Chrome will accept/return these fine anyway. This is needed for using
          // same-site = none
          this.cookies.secure = true
        }
        this.cookies.set(SESSION_KEY, null, { expires: new Date(0) })
      }
    },
  },
})
