import { atom, Getter, Setter } from 'jotai'
import { observe } from 'jotai-effect'
import { SiteConnectionRefusal } from '../../common/websockets'
import { jotaiStore } from '../jotai-store'

export type SiteConnectionStatus =
  /** No connection to the server, either because it dropped or we haven't connected yet. */
  | 'disconnected'
  /** Connected, but the server hasn't admitted the connection yet. */
  | 'admitting'
  | 'connected'
  /** The server won't admit this client, so we've stopped trying to connect. */
  | 'refused'

export interface SiteConnectionState {
  status: SiteConnectionStatus
  /**
   * When we last became connected or stopped being connected (ms since epoch). Moving between the
   * not-connected statuses doesn't change this, so it tells how long things have been unavailable.
   */
  since: number
  /** Why the server refused us, if it did. */
  refusal?: SiteConnectionRefusal
}

export function nextSiteConnectionState(
  prev: Readonly<SiteConnectionState>,
  status: SiteConnectionStatus,
  now: number,
  refusal?: SiteConnectionRefusal,
): SiteConnectionState {
  const changedAvailability = (prev.status === 'connected') !== (status === 'connected')
  return {
    status,
    since: changedAvailability ? now : prev.since,
    ...(status === 'refused' && refusal ? { refusal } : {}),
  }
}

/**
 * The detailed state of our connection to the server. Most things should use `isConnectedAtom`
 * instead; this is for UI that explains why we aren't connected.
 */
export const siteConnectionAtom = atom<SiteConnectionState>({
  status: 'disconnected',
  since: Date.now(),
})

/**
 * Whether we're connected to the server and it has admitted us, i.e. everything that needs the
 * server should work.
 */
export const isConnectedAtom = atom(get => get(siteConnectionAtom).status === 'connected')

export type Effect = (get: Getter, set: Setter) => void

/** Runs a jotai store update whenever the socket becomes connected. */
export function updateOnConnect(updater: Effect) {
  return observe((get, set) => {
    const isConnected = get(isConnectedAtom)
    // This only runs on changes, so if we're connected it means we *just* connected
    if (isConnected) {
      updater(get, set)
    }
  }, jotaiStore)
}
