import { Lobby, takenSlotCount } from '../../common/lobbies'
import { SbUserId } from '../../common/users/sb-user-id'

/**
 * Which "you'll be leaving your current lobby" copy applies to the viewer, given their current
 * lobby. Shared by every surface that lets someone trade their current lobby for a different one
 * (joining elsewhere, creating a new one), so the host/member/alone reasoning lives in one place.
 */
export enum LeaveCurrentLobbyVariant {
  Member = 'member',
  HostWithOthers = 'hostWithOthers',
  HostAlone = 'hostAlone',
}

/**
 * Determines which variant applies. Mirrors `Lobbies.removePlayer`'s host-migration behavior: a
 * host with company hands the role off to another occupant on the way out, while a host with no
 * one else in the lobby takes it down with them.
 */
export function leaveCurrentLobbyVariant(
  currentLobby: Lobby,
  viewerId: SbUserId,
): LeaveCurrentLobbyVariant {
  if (currentLobby.host.userId !== viewerId) {
    return LeaveCurrentLobbyVariant.Member
  }

  return takenSlotCount(currentLobby) <= 1
    ? LeaveCurrentLobbyVariant.HostAlone
    : LeaveCurrentLobbyVariant.HostWithOthers
}
