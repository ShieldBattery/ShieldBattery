import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useQuery } from 'urql'
import { MatchmakingType } from '../../common/matchmaking'
import { RaceChar } from '../../common/races'
import { SbUserId } from '../../common/users/sb-user-id'
import { graphql } from '../gql'
import { numberFormat, useFormat } from '../i18n/locale-formats'
import { RaceIcon } from '../lobbies/race-icon'
import { TextButton } from '../material/button'
import { SegmentedButtonGroup } from '../material/segmented-button'
import { LoadingDotsArea } from '../progress/dots'
import { bodySmall, labelLarge, labelMedium, titleSmall } from '../styles/typography'
import {
  ladderMatchupRows,
  MatchupRecordData,
  MatchupRow,
  MatchupScope,
  playerMatchupRows,
} from './matchup-rows'

/** Rows shown before the list is expanded. Most players have fewer matchups than this in 1v1. */
const COLLAPSED_ROWS = 5

const percentFormat = numberFormat({ style: 'percent', maximumFractionDigits: 0 })
const countFormat = numberFormat()

const UserMatchupsQuery = graphql(/* GraphQL */ `
  query UserMatchups($userId: SbUserId!, $matchmakingType: MatchmakingType!, $seasonId: Int) {
    userMatchups(userId: $userId, matchmakingType: $matchmakingType, seasonId: $seasonId) {
      id
      races
      opponentRaces
      wins
      losses
    }
  }
`)

const LadderMatchupsQuery = graphql(/* GraphQL */ `
  query LadderMatchups($matchmakingType: MatchmakingType!, $seasonId: Int) {
    ladderMatchups(matchmakingType: $matchmakingType, seasonId: $seasonId) {
      id
      races
      opponentRaces
      wins
      losses
    }
  }
`)

/** Module-level so the queries see the same context every render. */
const NO_SUSPENSE_CONTEXT = { suspense: false }

export type MatchupRecordsState =
  | { state: 'loading' }
  | { state: 'error' }
  | { state: 'ready'; records: ReadonlyArray<MatchupRecordData> }

/**
 * Fetches a player's and the ladder's matchup records for one mode and season. Both are a few
 * rows, and the player's view shows the ladder's rates beside its own, so both are always loaded.
 */
export function ConnectedMatchupStats({
  userId,
  matchmakingType,
  seasonId,
}: {
  userId: SbUserId
  matchmakingType: MatchmakingType
  /** The season to show, or undefined for every season summed. */
  seasonId?: number
}) {
  const [scope, setScope] = useState<MatchupScope>('player')
  const [playerResult] = useQuery({
    query: UserMatchupsQuery,
    variables: { userId, matchmakingType, seasonId: seasonId ?? null },
    context: NO_SUSPENSE_CONTEXT,
  })
  const [ladderResult] = useQuery({
    query: LadderMatchupsQuery,
    variables: { matchmakingType, seasonId: seasonId ?? null },
    context: NO_SUSPENSE_CONTEXT,
  })

  const toState = (
    records: ReadonlyArray<MatchupRecordData> | undefined,
    error: unknown,
  ): MatchupRecordsState => {
    if (records) return { state: 'ready', records }
    return error ? { state: 'error' } : { state: 'loading' }
  }

  return (
    <MatchupStats
      scope={scope}
      onScopeChange={setScope}
      player={toState(playerResult.data?.userMatchups, playerResult.error)}
      ladder={toState(ladderResult.data?.ladderMatchups, ladderResult.error)}
    />
  )
}

const Root = styled.section`
  container-type: inline-size;

  display: flex;
  flex-direction: column;
  gap: 12px;
`

const Header = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 16px;
`

const Title = styled.h3`
  ${titleSmall};
  margin: 0;
`

/**
 * Rows share one grid, so the bars line up however wide each row's numbers are. When the section is
 * too narrow for a bar beside them, each row puts its bar on a line of its own instead.
 */
const Rows = styled.div`
  display: grid;
  grid-template-columns: auto minmax(64px, 1fr) auto;
  row-gap: 12px;

  @container (width < 480px) {
    grid-template-columns: 1fr;
    row-gap: 16px;
  }
`

const Row = styled.div`
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: subgrid;
  grid-template-areas: 'label bar numbers';
  align-items: center;
  column-gap: 16px;

  @container (width < 480px) {
    grid-template-columns: 1fr auto;
    grid-template-areas:
      'label numbers'
      'bar bar';
    row-gap: 6px;
  }
`

const Label = styled.div`
  ${labelLarge};
  grid-area: label;
  display: flex;
  align-items: center;
  gap: 2px;

  color: var(--theme-on-surface-variant);
`

const SmallRaceIcon = styled(RaceIcon)`
  width: 20px;
  height: 20px;
  flex-shrink: 0;
`

const Versus = styled.span`
  ${labelMedium};
  padding: 0 4px;
`

const Bar = styled.div`
  grid-area: bar;
  position: relative;
  height: 10px;

  border-radius: 5px;
  overflow: hidden;
  background-color: var(--theme-container-highest);
`

const BarFill = styled.div`
  height: 100%;
  background-color: var(--theme-primary);
`

/** Marks 50% on a bar. */
const EvenMarker = styled.div`
  position: absolute;
  left: 50%;
  top: 0;
  bottom: 0;
  width: 1px;

  background-color: rgb(from var(--theme-on-surface) r g b / 0.45);
`

const Numbers = styled.div`
  ${labelLarge};
  grid-area: numbers;
  white-space: nowrap;

  display: flex;
  flex-direction: column;
  align-items: flex-end;

  font-variant-numeric: tabular-nums;
  text-align: right;
`

const Subtext = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
  font-variant-numeric: tabular-nums;
`

/** Takes the bar's and the numbers' places, for rows without a winrate. */
const WideSubtext = styled(Subtext)`
  grid-area: bar / bar / numbers / numbers;

  @container (width < 480px) {
    grid-area: numbers;
    text-align: right;
  }
`

const ShowAll = styled(TextButton)`
  align-self: flex-start;
`

function RaceIcons({ races }: { races: string }) {
  return Array.from(races).map((race, i) => <SmallRaceIcon key={i} race={race as RaceChar} />)
}

/**
 * Ranked records by matchup for one mode: the player's own (each beside the ladder's rate from the
 * same side) or the whole ladder's, most played first.
 */
export function MatchupStats({
  scope,
  onScopeChange,
  player,
  ladder,
}: {
  scope: MatchupScope
  onScopeChange: (scope: MatchupScope) => void
  player: MatchupRecordsState
  ladder: MatchupRecordsState
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)

  // The player's rows wait for the ladder's too, so their ladder rates don't pop in afterwards.
  let rows: MatchupRow[] | undefined
  let state: 'loading' | 'error' | 'ready' = 'loading'
  if (player.state === 'error' || ladder.state === 'error') {
    state = 'error'
  } else if (ladder.state === 'ready' && scope === 'ladder') {
    state = 'ready'
    rows = ladderMatchupRows(ladder.records)
  } else if (ladder.state === 'ready' && player.state === 'ready') {
    state = 'ready'
    rows = playerMatchupRows(player.records, ladder.records)
  }

  let body
  if (state === 'error') {
    body = (
      <Subtext>
        {t('users.profile.stats.matchups.loadError', "Couldn't load the matchup records.")}
      </Subtext>
    )
  } else if (!rows) {
    body = <LoadingDotsArea />
  } else if (!rows.length) {
    body = (
      <Subtext>
        {scope === 'player'
          ? t(
              'users.profile.stats.matchups.noPlayerGames',
              'No matchups to show for this player yet.',
            )
          : t(
              'users.profile.stats.matchups.noLadderGames',
              'No matchups to show for the ladder yet.',
            )}
      </Subtext>
    )
  } else {
    const shown = expanded ? rows : rows.slice(0, COLLAPSED_ROWS)
    body = (
      <>
        <Rows>
          {shown.map(row => (
            <MatchupRowView key={`${row.races}-${row.opponentRaces}`} row={row} scope={scope} />
          ))}
        </Rows>
        {rows.length > COLLAPSED_ROWS ? (
          <ShowAll
            label={
              expanded
                ? t('users.profile.stats.matchups.showFewer', 'Show fewer')
                : t('users.profile.stats.matchups.showAll', {
                    defaultValue: 'Show all {{count}} matchups',
                    count: rows.length,
                  })
            }
            iconEnd={expanded ? 'expand_less' : 'expand_more'}
            onClick={() => setExpanded(!expanded)}
          />
        ) : undefined}
      </>
    )
  }

  return (
    <Root>
      <Header>
        <Title>{t('users.profile.stats.matchups.title', 'Matchups')}</Title>
        <SegmentedButtonGroup
          ariaLabel={t('users.profile.stats.matchups.scope', 'Whose records to show')}
          segments={[
            { value: 'player', label: t('users.profile.stats.matchups.player', 'Player') },
            { value: 'ladder', label: t('users.profile.stats.matchups.ladder', 'Ladder') },
          ]}
          value={scope}
          onChange={onScopeChange}
        />
      </Header>
      {body}
      <Subtext>
        {t(
          'users.profile.stats.matchups.footnote',
          'Ranked games of at least 2 minutes with a clear winner. Updated every hour.',
        )}
      </Subtext>
    </Root>
  )
}

function MatchupRowView({ row, scope }: { row: MatchupRow; scope: MatchupScope }) {
  const { t } = useTranslation()
  const percent = useFormat(percentFormat)
  const count = useFormat(countFormat)

  const label = (
    <Label
      role='img'
      aria-label={t('users.profile.stats.matchups.matchupLabel', {
        defaultValue: '{{races}} vs. {{opponentRaces}}',
        races: row.races.toUpperCase(),
        opponentRaces: row.opponentRaces.toUpperCase(),
      })}>
      <RaceIcons races={row.races} />
      <Versus aria-hidden={true}>v</Versus>
      <RaceIcons races={row.opponentRaces} />
    </Label>
  )
  const games = t('users.profile.stats.matchups.games', {
    defaultValue: '{{formattedCount}} games',
    defaultValue_one: '{{formattedCount}} game',
    count: row.games,
    formattedCount: count.format(row.games),
  })
  const record =
    row.wins !== undefined && row.losses !== undefined
      ? `${count.format(row.wins)}–${count.format(row.losses)}`
      : undefined

  if (row.winRate === undefined) {
    // A ladder mirror (always even), or a ladder matchup with too few games for a rate.
    return (
      <Row>
        {label}
        <WideSubtext>
          {record ? `${record} · ` : ''}
          {games}
        </WideSubtext>
      </Row>
    )
  }

  return (
    <Row>
      {label}
      <Bar>
        <BarFill style={{ width: `${row.winRate * 100}%` }} />
        <EvenMarker />
      </Bar>
      <Numbers>
        <span>{percent.format(row.winRate)}</span>
        <Subtext>
          {scope === 'player' ? record : games}
          {row.ladderWinRate !== undefined
            ? ` · ${t('users.profile.stats.matchups.ladderRate', {
                defaultValue: 'ladder {{rate}}',
                rate: percent.format(row.ladderWinRate),
              })}`
            : undefined}
        </Subtext>
      </Numbers>
    </Row>
  )
}
