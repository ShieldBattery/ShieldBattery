import { Session } from 'koa-generic-session'

declare module 'koa' {
  interface ExtendableContext {
    session: Session | null
    sessionSave: boolean | null
    regenerateSession(): () => Promise<void>
  }
}
