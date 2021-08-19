// Injection decorators and association registration code for HTTP-related things

import { RouterContext } from '@koa/router'
import { AppSession } from 'koa'
import { inject, instanceCachingFactory } from 'tsyringe'
import { Permissions } from '../../../common/users/permissions'
import { TypedParamDecorator } from '../reflect/decorators'

const KOA_CONTEXT = Symbol('koaContext')
/** Injects a parameter with the current request's Koa Context object. */
export const injectKoaContext = (): TypedParamDecorator<RouterContext> => inject(KOA_CONTEXT)

const SESSION = Symbol('session')
/** Injects a parameter with the current request's session object. */
export const injectSession = (): TypedParamDecorator<AppSession> => inject(SESSION)

const USER_ID = Symbol('userId')
/** Injects a parameter with the current request's associated user ID. */
export const injectUserId = (): TypedParamDecorator<number> => inject(USER_ID)

const PERMISSIONS = Symbol('permissions')
/** Injects a parameter with the current request's associated user ID. */
export const injectPermissions = (): TypedParamDecorator<Permissions> => inject(PERMISSIONS)

/** Registers various HTTP-related */
export function registerForRequest(ctx: RouterContext) {
  const container = ctx.container
  container.register(KOA_CONTEXT, { useValue: ctx })
  container.register(SESSION, {
    useFactory: instanceCachingFactory(c => {
      const ctx = c.resolve<RouterContext>(KOA_CONTEXT)
      if (!ctx.session) {
        throw new Error('Attempted to inject a session object when no session exists')
      }
      return ctx.session
    }),
  })
  container.register(USER_ID, {
    useFactory: instanceCachingFactory(c => {
      const session = c.resolve<AppSession>(SESSION)
      if (!session.userId) {
        throw new Error('Attempted to inject a user ID when the request was not authenticated')
      }
      return session.userId
    }),
  })
  container.register(PERMISSIONS, {
    useFactory: instanceCachingFactory(c => {
      const session = c.resolve<AppSession>(SESSION)
      if (!session.userId) {
        throw new Error('Attempted to inject permissions when the request was not authenticated')
      }
      return session.permissions
    }),
  })
}
