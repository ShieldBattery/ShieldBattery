import { Logger } from 'pino'
import promClient from 'prom-client'
import { ReadonlyDeep } from 'type-fest'
import { SbPermissions } from '../common/users/permissions'
import { SelfUser } from '../common/users/sb-user'
import { SbUserId } from '../common/users/sb-user-id'

declare module 'koa' {
  interface AppSession {
    user: SelfUser
    permissions: SbPermissions
  }

  // NOTE(tec27): We add a bunch of things to ExtendedContext so that koa-router's more generic
  // Context extension stuff doesn't get broken by these libraries' more direct way of just
  // extending the final `Context` type (and make TS complain about these properties missing on
  // `RouterContext`)
  interface ExtendableContext {
    /**
     * A fast cache for user + permission information. Use `beginSession` or `deleteSession` to
     * change users. Use UserService for making changes to the current user/permissions to see them
     * reflected here.
     */
    session?: ReadonlyDeep<AppSession>
    /** Starts a new session for the given user, updating the `session` field to match. */
    beginSession(userId: SbUserId, stayLoggedIn: boolean): Promise<void>
    /** Deletes the current session, updating the `session` field to match. */
    deleteSession(): Promise<void>

    // for koa-views
    render(viewPath: string, locals?: any): Promise<void>

    /**
     * Marks that this request as not needing session cookies. This should generally be used on
     * things like EventSource routes where we need to flush headers prior to the session middleware
     * getting to save.
     */
    dontSendSessionCookies: boolean | undefined

    // For Prometheus additions
    prometheus: typeof promClient

    // From koa-pino-logger
    log: Logger
  }
}
