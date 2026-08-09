import { humanSlotCount, Lobby } from '../../common/lobbies'
import { SbUserId } from '../../common/users/sb-user-id'
import { useAppSelector } from '../redux-hooks'
import { isInLobby } from './lobby-reducer'

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
 * Determines which variant applies. Mirrors `Lobbies.removePlayer`'s host-migration behavior: the
 * lobby closes only when no humans (players or observers) remain after the host leaves, so
 * computers and closed slots don't count as company, while an observer does — they'd inherit the
 * host role.
 */
export function leaveCurrentLobbyVariant(
  currentLobby: Lobby,
  viewerId: SbUserId,
): LeaveCurrentLobbyVariant {
  if (currentLobby.host.userId !== viewerId) {
    return LeaveCurrentLobbyVariant.Member
  }

  return humanSlotCount(currentLobby) <= 1
    ? LeaveCurrentLobbyVariant.HostAlone
    : LeaveCurrentLobbyVariant.HostWithOthers
}

/**
 * Reads the viewer's leave-current-lobby situation out of the store for a confirmation prompt:
 * which copy variant applies, and the current lobby's name to slot into it. Falls back to
 * `Member` when the viewer isn't in a lobby at all (a prompt shown in that state has nothing to
 * warn about, but should still render sensibly).
 */
export function useLeaveCurrentLobbyPrompt(): {
  variant: LeaveCurrentLobbyVariant
  currentLobbyName: string
} {
  const selfId = useAppSelector(s => s.auth.self!.user.id)
  const inCurrentLobby = useAppSelector(s => isInLobby(s.lobby))
  const currentLobbyInfo = useAppSelector(s => s.lobby.info)

  return {
    variant: inCurrentLobby
      ? leaveCurrentLobbyVariant(currentLobbyInfo, selfId)
      : LeaveCurrentLobbyVariant.Member,
    currentLobbyName: currentLobbyInfo.name,
  }
}
