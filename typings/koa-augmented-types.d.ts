import { Session } from 'koa-generic-session'
import promClient from 'prom-client'
import { SbPermissions } from '../common/users/permissions'
import { SbUserId } from '../common/users/sb-user'

declare module 'koa' {
  interface AppSession extends Session {
    // TODO(tec27): Maybe just move these user fields into a SelfUser to keep things synced up?
    userId: SbUserId
    userName: string
    email: string
    emailVerified: boolean
    acceptedPrivacyVersion: number
    acceptedTermsVersion: number
    acceptedUsePolicyVersion: number

    permissions: SbPermissions
  }

  // NOTE(tec27): We add a bunch of things to ExtendedContext so that koa-router's more generic
  // Context extension stuff doesn't get broken by these libraries' more direct way of just
  // extending the final `Context` type (and make TS complain about these properties missing on
  // `RouterContext`)
  interface ExtendableContext {
    // for koa-generic-session
    session: AppSession | null
    sessionId: string | null
    sessionSave: boolean | null
    regenerateSession(): Promise<void>

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
  }
}
