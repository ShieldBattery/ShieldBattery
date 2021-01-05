import { IncomingMessage } from 'http'
import { singleton } from 'tsyringe'

export interface SessionInfo {
  sessionId: string
  userId: number
  clientId: string
  userName: string
  address: string
}

@singleton()
export class RequestSessionLookup extends WeakMap<IncomingMessage, SessionInfo> {}
