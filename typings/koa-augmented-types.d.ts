import { Session } from 'koa-generic-session'

declare module 'koa' {
  // NOTE(tec27): We add a bunch of things to ExtendedContext so that koa-router's more generic
  // Context extension stuff doesn't get broken by these libraries' more direct way of just
  // extending the final `Context` type (and make TS complain about these properties missing on
  // `RouterContext`)
  interface ExtendableContext {
    // for koa-csrf
    csrf: string

    // for koa-generic-session
    session: Session | null
    sessionSave: boolean | null
    regenerateSession(): () => Promise<void>

    // for koa-views
    render(viewPath: string, locals?: any): Promise<void>
  }
}
