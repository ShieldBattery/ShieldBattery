import { SbUserId } from '../users/sb-user-id'

/** Events sent to a user's clients on their commends path (see `getCommendsPath`). */
export type CommendEvent = CommendReceivedEvent

/**
 * Another player commended this user. Clients turn this into a local notification, which is never
 * stored on the server.
 */
export interface CommendReceivedEvent {
  type: 'commendReceived'
  gameId: string
  commenderId: SbUserId
}
