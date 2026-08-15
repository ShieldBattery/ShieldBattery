import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { getPlayerSlots } from '../../../common/lobbies'
import { SlotType } from '../../../common/lobbies/slot'
import { SbUserId } from '../../../common/users/sb-user-id'
import { ConnectedAvatar } from '../../avatars/avatar'
import { MaterialIcon } from '../../icons/material/material-icon'
import { useAppSelector } from '../../redux-hooks'
import { bodyMedium, labelMedium, labelSmall, singleLine } from '../../styles/typography'
import { ConnectedUsername } from '../../users/connected-username'
import { LobbyUserMenu } from '../lobby-menu-items'
import { getWinsByUser } from './room-parts'

const ScoreboardRoot = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`

const ScoreboardHeader = styled.div`
  padding-bottom: 4px;

  display: flex;
  align-items: center;
  justify-content: space-between;

  border-bottom: 1px solid var(--theme-outline-variant);
`

const ScoreboardHeaderLabel = styled.div`
  ${labelSmall};
  color: var(--theme-on-surface-variant);
`

const ScoreboardRow = styled.div`
  min-height: 32px;

  display: flex;
  align-items: center;
  gap: 8px;
`

const ScoreboardRank = styled.div`
  ${labelMedium};
  width: 16px;
  flex-shrink: 0;
  color: var(--theme-on-surface-variant);
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
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
`

const ScoreboardTrophyIcon = styled(MaterialIcon)`
  flex-shrink: 0;
  color: var(--theme-amber);
`

const ScoreboardWinsValue = styled.span<{ $leading: boolean }>`
  ${labelMedium};
  color: ${props => (props.$leading ? 'var(--theme-amber)' : 'inherit')};
`

/**
 * The lobby's running standings: every player who has won a game in this lobby, plus everyone
 * currently seated to play, ranked by wins.
 */
export function LobbyScoreboard() {
  const { t } = useTranslation()
  const series = useAppSelector(s => s.lobby.series)
  const lobby = useAppSelector(s => s.lobby.info)
  const usersById = useAppSelector(s => s.users.byId)

  const wins = getWinsByUser(series)
  const seatedPlayerIds = getPlayerSlots(lobby)
    .filter(slot => slot.type === SlotType.Human)
    .map(slot => slot.userId)
    .filter((userId): userId is SbUserId => userId !== undefined)

  const standings = Array.from(new Set<SbUserId>([...wins.keys(), ...seatedPlayerIds]))
    .map(userId => ({
      userId,
      wins: wins.get(userId) ?? 0,
      name: usersById.get(userId)?.name ?? '…',
    }))
    .sort((a, b) => b.wins - a.wins || a.name.localeCompare(b.name))

  // Competition ranking: rows with equal wins share a rank, and the next distinct wins value
  // ranks by how many rows precede it, so e.g. wins 3, 1, 1, 0 rank 1, 2, 2, 4.
  const rows: Array<{ userId: SbUserId; wins: number; name: string; rank: number }> = []
  let previousWins: number | undefined
  let previousRank = 0
  for (let index = 0; index < standings.length; index++) {
    const row = standings[index]
    const rank = row.wins === previousWins ? previousRank : index + 1
    previousWins = row.wins
    previousRank = rank
    rows.push({ ...row, rank })
  }

  return (
    <ScoreboardRoot>
      <ScoreboardHeader>
        <ScoreboardHeaderLabel>
          {t('lobbies.room.scoreboard.player', 'Player')}
        </ScoreboardHeaderLabel>
        <ScoreboardHeaderLabel>{t('lobbies.room.scoreboard.wins', 'Wins')}</ScoreboardHeaderLabel>
      </ScoreboardHeader>
      {rows.map(row => {
        const leading = row.rank === 1 && row.wins > 0

        return (
          <ScoreboardRow key={row.userId}>
            <ScoreboardRank>{row.rank}</ScoreboardRank>
            <ScoreboardAvatar userId={row.userId} />
            <ScoreboardName>
              <ConnectedUsername userId={row.userId} UserMenu={LobbyUserMenu} />
            </ScoreboardName>
            <ScoreboardWins>
              {leading ? <ScoreboardTrophyIcon icon='trophy' size={14} filled /> : null}
              <ScoreboardWinsValue $leading={leading}>{row.wins}</ScoreboardWinsValue>
            </ScoreboardWins>
          </ScoreboardRow>
        )
      })}
    </ScoreboardRoot>
  )
}
