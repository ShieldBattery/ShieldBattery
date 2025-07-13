import { urlPath } from '../../../common/urls'
import { SbUserId } from '../../../common/users/sb-user-id'
import { ClientSocketsGroup } from '../websockets/socket-groups'

export function getMatchmakingUserPath(userId: SbUserId) {
  return urlPath`/matchmaking/${userId}`
}

export function getMatchmakingClientPath(client: ClientSocketsGroup) {
  return urlPath`/matchmaking/${client.userId}/${client.clientId}`
}

export function getMatchPath(matchId: string) {
  return urlPath`/matchmaking/matches/${matchId}`
}

export function getMatchTeamPath(matchId: string, teamId: number) {
  return urlPath`/matchmaking/matches/${matchId}/teams/${teamId}`
}
