import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { GameType, isTeamType } from '../../../common/games/game-type'
import { range } from '../../../common/range'
import { bodySmall, labelMedium } from '../../styles/typography'

const TEAM_COLORS = [
  'var(--color-blue60)',
  'var(--color-amber60)',
  'var(--color-purple60)',
  'var(--color-grey-blue70)',
]

const Row = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 14px;
  row-gap: 6px;
`

const Groups = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
`

const PipGroup = styled.div`
  display: flex;
  gap: 4px;
`

const Pip = styled.div<{ $color: string }>`
  width: 11px;
  height: 11px;
  flex-shrink: 0;
  border-radius: 3px;
  background-color: ${props => props.$color};
`

const VsLabel = styled.div`
  ${labelMedium};
  color: var(--theme-on-surface-variant);
`

const Caption = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
`

/** Splits `slots` as evenly as possible across `teamCount` teams, front-loading the remainder. */
export function evenTeamSizes(slots: number, teamCount: number): number[] {
  return Array.from(
    range(0, teamCount),
    i => Math.floor(slots / teamCount) + (i < slots % teamCount ? 1 : 0),
  )
}

function PipGroupView({ count, colorIndex }: { count: number; colorIndex: number }) {
  const color = TEAM_COLORS[colorIndex % TEAM_COLORS.length]
  return (
    <PipGroup>
      {Array.from(range(0, count), i => (
        <Pip key={i} $color={color} />
      ))}
    </PipGroup>
  )
}

export interface SlotsPreviewProps {
  gameType: GameType
  /** For TopVsBottom: the top team's seat count; for other team types: the number of teams. */
  gameSubType: number
  /** The number of player slots to visualize (already UMS-adjusted by the caller). */
  slots: number
  mapName: string
}

/** A read-only visualization of how the selected map's slots split up under the current game type. */
export function SlotsPreview({ gameType, gameSubType, slots, mapName }: SlotsPreviewProps) {
  const { t } = useTranslation()

  let groups: React.ReactNode
  let caption: string

  if (gameType === GameType.TopVsBottom) {
    const top = gameSubType
    const bottom = slots - gameSubType
    groups = (
      <>
        <PipGroupView count={top} colorIndex={0} />
        <VsLabel>{t('lobbies.createLobby.slotsPreviewVs', 'VS')}</VsLabel>
        <PipGroupView count={bottom} colorIndex={1} />
      </>
    )
    caption = t('lobbies.createLobby.slotsPreviewTvb', {
      defaultValue: '{{top}} vs {{bottom}} on {{mapName}}',
      top,
      bottom,
      mapName,
    })
  } else if (isTeamType(gameType)) {
    // TeamMelee and TeamFreeForAll: `gameSubType` is the number of teams sharing the slots.
    const teamSizes = evenTeamSizes(slots, gameSubType)
    groups = (
      <>
        {teamSizes
          .map((size, teamIndex) => ({ size, teamIndex }))
          .filter(({ size }) => size > 0)
          .map(({ size, teamIndex }) => (
            <PipGroupView key={teamIndex} count={size} colorIndex={teamIndex} />
          ))}
      </>
    )
    caption = t('lobbies.createLobby.slotsPreviewTeams', {
      defaultValue: '{{numTeams}} teams sharing {{count}} slots',
      numTeams: gameSubType,
      count: slots,
    })
  } else if (gameType === GameType.OneVsOne) {
    groups = (
      <>
        <PipGroupView count={1} colorIndex={0} />
        <VsLabel>{t('lobbies.createLobby.slotsPreviewVs', 'VS')}</VsLabel>
        <PipGroupView count={1} colorIndex={1} />
      </>
    )
    caption = t('lobbies.createLobby.slotsPreviewOneOnOne', 'Head-to-head · 2 players')
  } else if (gameType === GameType.UseMapSettings) {
    groups = <PipGroupView count={slots} colorIndex={0} />
    caption = t('lobbies.createLobby.slotsPreviewUms', {
      defaultValue: '{{count}} slots · layout set by the map',
      count: slots,
    })
  } else {
    // Melee, FreeForAll: every slot is an open, unaligned seat.
    groups = <PipGroupView count={slots} colorIndex={0} />
    caption = t('lobbies.createLobby.slotsPreviewOpen', {
      defaultValue: '{{count}} open slots on {{mapName}}',
      count: slots,
      mapName,
    })
  }

  return (
    <Row>
      <Groups>{groups}</Groups>
      <Caption>{caption}</Caption>
    </Row>
  )
}
