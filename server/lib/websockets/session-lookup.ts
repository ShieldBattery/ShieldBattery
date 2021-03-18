import { IncomingMessage } from 'http'
import { NydusClient } from 'nydus'
import { singleton } from 'tsyringe'

export interface SessionInfo {
  sessionId: string
  userId: number
  clientId: string
  userName: string
  address: string
  clientType: 'web' | 'electron'
}

@singleton()
export class RequestSessionLookup extends WeakMap<IncomingMessage, SessionInfo> {
  fromSocket(socket: NydusClient): SessionInfo | undefined {
    return this.get(socket.conn.request)
  }
}
