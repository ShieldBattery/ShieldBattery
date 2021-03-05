import { Session, session } from 'electron'

let curSession: Session | null = null

// Returns the current session, initializing it if it has not been initialized already. Should only
// be called after the 'ready' event.
export default function getCurrentSession(): Session {
  if (!curSession) {
    // TODO(tec27): include server name in this as well
    const sessionName = process.env.SB_SESSION || 'session'
    curSession = session.fromPartition(`persist:${sessionName}`)
  }

  return curSession
}
