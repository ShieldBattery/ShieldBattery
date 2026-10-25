import { ClientChallenge } from './users/client-proof'

/** An event that's sent to the client to let them know their client sockets are now subscribed. */
export interface SubscribedClientEvent {
  type: 'subscribedClient'
}

/** An event that's sent to the client to let them know their user sockets are now subscribed. */
export interface SubscribedUserEvent {
  type: 'subscribedUser'
}

/** Each socket is told about the state of its own connection on this path (plus its ID). */
export const SITE_CONNECTION_PATH = '/siteConnection'

export function siteConnectionPath(socketId: string) {
  return `${SITE_CONNECTION_PATH}/${socketId}`
}

export type SiteConnectionRefusal = 'clientVerification' | 'clientUpdate'

export type SiteConnectionEvent =
  | { type: 'challenge'; challenge: ClientChallenge }
  | { type: 'admitted' }
  | { type: 'refused'; reason: SiteConnectionRefusal }
