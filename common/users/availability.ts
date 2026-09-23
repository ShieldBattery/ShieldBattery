import { SbUserId } from './sb-user-id'

/**
 * How available a user has said they are, independent of what they're doing (see
 * `FriendActivityStatus`): a user can be away and in a lobby at once. Set only by the user, and kept
 * until they change it.
 */
export enum UserAvailability {
  Online = 'online',
  Away = 'away',
  /** Also quiets alerts for incoming channel messages and whispers on all of the user's sessions. */
  DoNotDisturb = 'dnd',
}

export const ALL_USER_AVAILABILITIES: ReadonlyArray<UserAvailability> =
  Object.values(UserAvailability)

export function isUserAvailability(value: unknown): value is UserAvailability {
  return ALL_USER_AVAILABILITIES.includes(value as UserAvailability)
}

/** The longest status message a user can set, in characters, after trimming. */
export const MAX_STATUS_MESSAGE_LENGTH = 64

/** A user's availability as other users see it while that user is online. */
export interface AvailabilityInfo {
  availability: UserAvailability
  /** A short, single-line message to go with the availability. Empty if none is set. */
  statusMessage: string
}

export const DEFAULT_AVAILABILITY_INFO: Readonly<AvailabilityInfo> = {
  availability: UserAvailability.Online,
  statusMessage: '',
}

/** Whether `info` is what every online user has unless they've set something else. */
export function isDefaultAvailabilityInfo(info: Readonly<AvailabilityInfo>): boolean {
  return (
    info.availability === DEFAULT_AVAILABILITY_INFO.availability &&
    info.statusMessage === DEFAULT_AVAILABILITY_INFO.statusMessage
  )
}

/**
 * Sent to a user's friends on `/availability/:userId`, both as the initial data when a friend
 * subscribes (only if the user is online) and whenever the user's availability changes or they
 * come online or go offline.
 */
export interface AvailabilityUpdateEvent {
  userId: SbUserId
  /** The user's current availability, or `null` if they're offline. */
  info: AvailabilityInfo | null
}
