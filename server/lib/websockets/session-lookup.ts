import { IncomingMessage } from 'http'

export interface SessionInfo {
  sessionId: string
  userId: number
  clientId: string
  userName: string
  address: string
}

export type RequestSessionLookup = WeakMap<IncomingMessage, SessionInfo>
