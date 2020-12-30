declare module 'koa-generic-session' {
  import * as Koa from 'koa'

  export interface Session {
    cookie: any
    [key: string]: any
  }

  export interface SessionIdStore {
    get(): any
    set(sid: string, session: Session): void
    reset(): void
  }

  export interface SessionStore {
    (): SessionStore
    get(sid: string): any
    set(sid: string, session: Session, ttl: number): void
    destroy(sid: string): void
  }

  export interface SessionOptions {
    key?: string
    store?: SessionStore
    ttl?: number
    prefix?: string
    cookie?: {
      path?: string
      rewrite?: boolean
      signed?: boolean
      maxAge?: number | null
      secure?: boolean
      httpOnly?: boolean
      sameSite?: boolean | 'lax' | 'none' | 'strict'
      overwrite?: boolean
    }
    allowEmpty?: boolean
    defer?: boolean
    reconnectTimeout?: number
    rolling?: boolean
    sessionIdStore?: SessionIdStore
    genSid?(length: number): string
    errorHandler?(error: Error, type: string, ctx: Koa.Context): void
    valid?(ctx: Koa.Context, session: Session): boolean
    beforeSave?(ctx: Koa.Context, session: Session): void
  }

  export const MemoryStore: SessionStore

  export default function koaSession(options: SessionOptions): Koa.Middleware
}
