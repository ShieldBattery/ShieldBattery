import { useAtomValue } from 'jotai'
import styled from 'styled-components'
import { getPlayerSlots } from '../../../common/lobbies'
import { SlotType } from '../../../common/lobbies/slot'
import { SbUserId } from '../../../common/users/sb-user-id'
import { ConnectedAvatar } from '../../avatars/avatar'
import { useAppSelector } from '../../redux-hooks'
import { bodyMedium, labelMedium, singleLine } from '../../styles/typography'
import { ConnectedUsername } from '../../users/connected-username'
import { LobbyUserMenu } from '../lobby-menu-items'
import { getWinsByUser, lobbySeriesAtom } from './room-atoms'

const ScoreboardRoot = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`

const ScoreboardRow = styled.div`
  min-height: 32px;

  display: flex;
  align-items: center;
  gap: 8px;
`

const ScoreboardAvatar = styled(ConnectedAvatar)`
  width: 24px;
  height: 24px;
  flex-shrink: 0;
`

const ScoreboardName = styled.div`
  ${bodyMedium};
  ${singleLine};
  flex-grow: 1;
  min-width: 0;
`

const ScoreboardWins = styled.div`
  ${labelMedium};
  text-align: right;
`

/**
 * The lobby's running standings for the night: every player who has won a game, plus everyone
 * currently seated to play, ranked by wins.
 */
export function LobbyScoreboard() {
  const series = useAtomValue(lobbySeriesAtom)
  const lobby = useAppSelector(s => s.lobby.info)
  const usersById = useAppSelector(s => s.users.byId)

  const wins = getWinsByUser(series)
  const seatedPlayerIds = getPlayerSlots(lobby)
    .filter(slot => slot.type === SlotType.Human)
    .map(slot => slot.userId)
    .filter((userId): userId is SbUserId => userId !== undefined)

  const rows = Array.from(new Set<SbUserId>([...wins.keys(), ...seatedPlayerIds]))
    .map(userId => ({
      userId,
      wins: wins.get(userId) ?? 0,
      name: usersById.get(userId)?.name ?? '…',
    }))
    .sort((a, b) => b.wins - a.wins || a.name.localeCompare(b.name))

  return (
    <ScoreboardRoot>
      {rows.map(row => (
        <ScoreboardRow key={row.userId}>
          <ScoreboardAvatar userId={row.userId} />
          <ScoreboardName>
            <ConnectedUsername userId={row.userId} UserMenu={LobbyUserMenu} />
          </ScoreboardName>
          <ScoreboardWins>{row.wins}</ScoreboardWins>
        </ScoreboardRow>
      ))}
    </ScoreboardRoot>
  )
}
