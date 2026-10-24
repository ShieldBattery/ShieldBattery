import * as React from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useQuery } from 'urql'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { getGameDurationString } from '../../common/games/games'
import {
  compositionWinRates,
  isMirrorMatchup,
  MapMatchupCounts,
  matchupWinRates,
} from '../../common/map-matchups'
import {
  getMatchmakingModeInfo,
  makeSeasonId,
  MatchmakingType,
  matchmakingTypeToLabel,
} from '../../common/matchmaking'
import { RaceChar } from '../../common/races'
import { loadMatchmakingSeasons } from '../games/game-link-card'
import { FragmentType, graphql, useFragment } from '../gql'
import { MapKind } from '../gql/graphql'
import { NarrowDuration } from '../i18n/date-formats'
import { dateTimeFormat, numberFormat, useFormat } from '../i18n/locale-formats'
import { RaceIcon } from '../lobbies/race-icon'
import { SectionLabel } from '../lobbies/room/room-parts'
import { Card } from '../material/card'
import { SegmentedButtonGroup } from '../material/segmented-button'
import { SelectOption } from '../material/select/option'
import { Select } from '../material/select/select'
import { Tooltip } from '../material/tooltip'
import { LoadingDotsArea } from '../progress/dots'
import { useAppSelector } from '../redux-hooks'
import { getRaceColor } from '../styles/colors'
import { bodyMedium, bodySmall, labelLarge, labelMedium, titleLarge } from '../styles/typography'
import { groupMatchupSeasons, weeklyBarHeights } from './map-page-summaries'

/** How many weeks of activity the stats card draws. */
const ACTIVITY_WEEKS = 26

const percentFormat = numberFormat({ style: 'percent', maximumFractionDigits: 0 })
const countFormat = numberFormat()
const weekFormat = dateTimeFormat({ year: 'numeric', month: 'short', day: 'numeric' })

export const MapPageStats_MapFragment = graphql(/* GraphQL */ `
  fragment MapPageStats_MapFragment on SbMap {
    id
    kind
    stats {
      id
      gamesTotal
      games28d
      players90d
      medianLength90d
      lastPlayedAt
    }
    versionCount
    lineStats {
      id
      gamesTotal
    }
    weeklyActivity(weeks: 26) {
      id
      weekStart
      lobbyGames
      matchmakingGames
    }
  }
`)

const StatsCard = styled(Card)`
  padding: 16px 20px;

  display: flex;
  flex-direction: column;
  gap: 12px;
`

const Numbers = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 16px 32px;
`

const NumberValue = styled.div`
  ${titleLarge};
  font-variant-numeric: tabular-nums;
  color: var(--theme-on-surface);
`

const NumberLabel = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
`

const Sparkline = styled.div`
  flex: 1 1 160px;
  min-width: 140px;

  display: flex;
  flex-direction: column;
  gap: 4px;
`

const SparklineBars = styled.div`
  height: 36px;

  display: flex;
  align-items: flex-end;
  gap: 2px;
`

const SparklineBarSlot = styled(Tooltip)`
  flex: 1 1 0;
  max-width: 8px;
  height: 100%;

  display: flex;
  align-items: flex-end;
`

const SparklineBar = styled.div`
  width: 100%;
  /* Weeks with any games stay visible even next to a much busier one. */
  min-height: 2px;

  border-radius: 1px 1px 0 0;
  background-color: rgb(from var(--color-blue60) r g b / 0.8);
`

const EmptySparklineBar = styled.div`
  width: 100%;
  height: 1px;

  background-color: var(--theme-outline-variant);
`

const StatsLine = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

/**
 * How much the map is played: totals, a weekly activity sparkline, and the lobby game type it's
 * usually played as when that's not the obvious one.
 */
export function MapStatsCard({
  map: mapRef,
}: {
  map: FragmentType<typeof MapPageStats_MapFragment>
}) {
  const { t } = useTranslation()
  const map = useFragment(MapPageStats_MapFragment, mapRef)
  const count = useFormat(countFormat)
  const week = useFormat(weekFormat)

  // Games stay per file everywhere else on the page, since what changed between versions is what
  // their numbers measure
  const lineGames =
    map.lineStats && map.versionCount > 1 ? (
      <StatsLine>
        {t('maps.page.lineGames', {
          defaultValue: '{{formattedCount}} games across {{versions}} versions',
          defaultValue_one: '{{formattedCount}} game across {{versions}} versions',
          count: map.lineStats.gamesTotal,
          formattedCount: count.format(map.lineStats.gamesTotal),
          versions: map.versionCount,
        })}
      </StatsLine>
    ) : null

  const stats = map.stats
  if (!stats) {
    return (
      <StatsCard>
        <StatsLine>{t('maps.page.notPlayedYet', 'Not played yet.')}</StatsLine>
        {lineGames}
      </StatsCard>
    )
  }

  const weeklyTotals = map.weeklyActivity.map(w => w.lobbyGames + w.matchmakingGames)
  const barHeights = weeklyBarHeights(weeklyTotals)
  const isUms = map.kind === MapKind.Ums

  return (
    <StatsCard>
      <Numbers>
        <div>
          <NumberValue>{count.format(stats.gamesTotal)}</NumberValue>
          <NumberLabel>{t('maps.page.gamesPlayed', 'games played')}</NumberLabel>
        </div>
        <div>
          <NumberValue>{count.format(stats.players90d)}</NumberValue>
          <NumberLabel>{t('maps.page.players90d', 'players, last 90 days')}</NumberLabel>
        </div>
        {stats.medianLength90d !== null && stats.medianLength90d !== undefined ? (
          <div>
            <NumberValue>{getGameDurationString(stats.medianLength90d)}</NumberValue>
            <NumberLabel>
              {isUms
                ? t('maps.page.medianSession', 'median session')
                : t('maps.page.medianGame', 'median game')}
            </NumberLabel>
          </div>
        ) : null}
        <Sparkline>
          <SparklineBars>
            {map.weeklyActivity.map((w, i) => (
              <SparklineBarSlot
                key={w.id}
                tabIndex={-1}
                position='top'
                text={t('maps.page.weekGames', {
                  defaultValue: 'Week of {{week}}: {{count}} games',
                  defaultValue_one: 'Week of {{week}}: {{count}} game',
                  week: week.format(new Date(w.weekStart)),
                  count: weeklyTotals[i],
                })}>
                {weeklyTotals[i] > 0 ? (
                  <SparklineBar style={{ height: `${barHeights[i] * 100}%` }} />
                ) : (
                  <EmptySparklineBar />
                )}
              </SparklineBarSlot>
            ))}
          </SparklineBars>
          <NumberLabel>
            {t('maps.page.weeklyGamesCaption', {
              defaultValue: 'games per week, last {{count}} weeks',
              count: ACTIVITY_WEEKS,
            })}
          </NumberLabel>
        </Sparkline>
      </Numbers>
      {stats.games28d === 0 ? (
        <StatsLine>
          {t('maps.page.lastPlayed', 'Last played')}{' '}
          <NarrowDuration to={new Date(stats.lastPlayedAt)} />
        </StatsLine>
      ) : null}
      {lineGames}
    </StatsCard>
  )
}

export const MapPageMatchups_MapFragment = graphql(/* GraphQL */ `
  fragment MapPageMatchups_MapFragment on SbMap {
    id
    kind
    matchupSeasons {
      id
      seasonId
      matchmakingType
      games
    }
  }
`)

/**
 * Requests results without suspending: the page renders its own loading state instead. Module-level so
 * the query sees the same context every render (a new object would make it start over).
 */
const NO_SUSPENSE_CONTEXT = { suspense: false }

const MapMatchupsQuery = graphql(/* GraphQL */ `
  query MapMatchups($id: SbMapId!, $matchmakingType: MatchmakingType!, $seasonId: Int) {
    map(id: $id) {
      id
      matchups(matchmakingType: $matchmakingType, seasonId: $seasonId) {
        id
        matchup
        games
        leftWins
        rightWins
        medianLength
      }
    }
  }
`)

const MatchupsCard = styled(Card)`
  padding: 16px 20px;

  display: flex;
  flex-direction: column;
  gap: 16px;
`

const MatchupsHeader = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 16px;
`

const MatchupsControls = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 16px;
`

const SeasonSelect = styled(Select)`
  width: 180px;
`

const MatchupRows = styled.div<{ $compositions?: boolean }>`
  /* Every row's label column is the same width, so the bars line up. A 3v3 composition is three
     race icons wide. */
  --sb-matchup-label-width: ${props => (props.$compositions ? '72px' : '48px')};

  display: flex;
  flex-direction: column;
  gap: 12px;
`

const MatchupRow = styled.div`
  display: grid;
  grid-template-columns: var(--sb-matchup-label-width) minmax(64px, 1fr) auto;
  align-items: center;
  gap: 12px;
`

const MatchupLabel = styled.div`
  ${labelLarge};
  display: flex;
  align-items: center;
  gap: 4px;

  color: var(--theme-on-surface);
`

const SmallRaceIcon = styled(RaceIcon)`
  width: 20px;
  height: 20px;
  flex-shrink: 0;
`

const Bar = styled.div`
  position: relative;
  height: 10px;

  display: flex;
  border-radius: 5px;
  overflow: hidden;
  background-color: var(--theme-container-highest);
`

const BarSegment = styled.div`
  height: 100%;
`

/** Marks 50% on a composition's bar. */
const EvenMarker = styled.div`
  position: absolute;
  left: 50%;
  top: 0;
  bottom: 0;
  width: 1px;

  background-color: rgb(from var(--theme-on-surface) r g b / 0.45);
`

const MatchupNumbers = styled.div`
  ${labelMedium};
  white-space: nowrap;

  display: flex;
  flex-direction: column;
  align-items: flex-end;

  font-variant-numeric: tabular-nums;
  color: var(--theme-on-surface);
  text-align: right;
`

const MatchupSubtext = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
  font-variant-numeric: tabular-nums;
`

const NotEnoughGames = styled.div`
  ${bodySmall};
  grid-column: 2 / -1;
  color: var(--theme-on-surface-variant);
`

const Footnote = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
`

function racesOf(composition: string): RaceChar[] {
  return Array.from(composition) as RaceChar[]
}

function RaceIcons({ composition }: { composition: string }) {
  return racesOf(composition).map((race, i) => <SmallRaceIcon key={i} race={race} />)
}

function matchupLabel(matchup: string): string {
  return matchup
    .split('-')
    .map(side => side.toUpperCase())
    .join('v')
}

/**
 * Matchmaking results on a melee map: the winrate of each 1v1 matchup, or of each race composition
 * in team modes. Lets the viewer pick the matchmaking type (among those with results) and a single
 * season, defaulting to every season summed.
 */
export function MapMatchupsCard({
  map: mapRef,
}: {
  map: FragmentType<typeof MapPageMatchups_MapFragment>
}) {
  const { t } = useTranslation()
  const map = useFragment(MapPageMatchups_MapFragment, mapRef)
  const types = groupMatchupSeasons(map.matchupSeasons)

  const [pickedType, setPickedType] = useState<MatchmakingType>()
  const [pickedSeasonId, setPickedSeasonId] = useState<number>()

  const typeSeasons = types.find(entry => entry.type === pickedType) ?? types[0]
  const matchmakingType = typeSeasons?.type
  // A season picked under another type may have no results under this one.
  const seasonId =
    pickedSeasonId !== undefined && typeSeasons?.seasonIds.includes(pickedSeasonId)
      ? pickedSeasonId
      : undefined

  const seasonsById = useAppSelector(s => s.matchmakingSeasons.byId)
  const needsSeasonNames = types.some(entry =>
    entry.seasonIds.some(id => !seasonsById.has(makeSeasonId(id))),
  )
  useEffect(() => {
    if (needsSeasonNames) {
      loadMatchmakingSeasons().catch(swallowNonBuiltins)
    }
  }, [needsSeasonNames])

  const [{ data, error }] = useQuery({
    query: MapMatchupsQuery,
    variables: {
      id: map.id,
      matchmakingType: matchmakingType ?? MatchmakingType.Match1v1,
      seasonId: seasonId ?? null,
    },
    pause: map.kind !== MapKind.Melee || !matchmakingType,
    context: NO_SUSPENSE_CONTEXT,
  })

  if (map.kind !== MapKind.Melee || !typeSeasons || !matchmakingType) {
    return null
  }

  const seasonName = (id: number) =>
    seasonsById.get(makeSeasonId(id))?.name ??
    t('maps.page.seasonNumber', { defaultValue: 'Season {{season}}', season: id })

  const rows: ReadonlyArray<MapMatchupCounts & { medianLength?: number | null }> =
    data?.map?.matchups ?? []
  const isOneVsOne = getMatchmakingModeInfo(matchmakingType).format === '1v1'

  let body: React.ReactNode
  if (!data) {
    body = error ? (
      <MatchupSubtext>
        {t('maps.page.matchupsError', "Couldn't load the matchup results.")}
      </MatchupSubtext>
    ) : (
      <LoadingDotsArea />
    )
  } else if (!rows.length) {
    body = (
      <MatchupSubtext>
        {t('maps.page.noMatchups', 'No ranked games in this season yet.')}
      </MatchupSubtext>
    )
  } else if (isOneVsOne) {
    body = (
      <MatchupRows>
        {/* Mirrors have no winrate to show, so they follow the matchups that do. */}
        {[
          ...rows.filter(r => !isMirrorMatchup(r.matchup)),
          ...rows.filter(r => isMirrorMatchup(r.matchup)),
        ].map(row => (
          <OneVsOneMatchupRow key={row.matchup} row={row} allSeasons={seasonId === undefined} />
        ))}
      </MatchupRows>
    )
  } else {
    body = (
      <MatchupRows $compositions={true}>
        {compositionWinRates(rows).map(row => (
          <CompositionRow
            key={row.composition}
            composition={row.composition}
            games={row.games}
            winRate={row.winRate}
          />
        ))}
      </MatchupRows>
    )
  }

  return (
    <MatchupsCard>
      <MatchupsHeader>
        <SectionLabel>{t('maps.page.matchupWinrates', 'Matchup winrates')}</SectionLabel>
        <MatchupsControls>
          {types.length > 1 ? (
            <SegmentedButtonGroup
              ariaLabel={t('maps.page.matchmakingType', 'Matchmaking type')}
              segments={types.map(entry => ({
                value: entry.type,
                label: matchmakingTypeToLabel(entry.type, t),
              }))}
              value={matchmakingType}
              onChange={setPickedType}
            />
          ) : (
            <MatchupSubtext>{matchmakingTypeToLabel(matchmakingType, t)}</MatchupSubtext>
          )}
          <SeasonSelect
            dense={true}
            allowErrors={false}
            ariaLabel={t('maps.page.season', 'Season')}
            value={seasonId ?? 'all'}
            onChange={(value: number | 'all') =>
              setPickedSeasonId(value === 'all' ? undefined : value)
            }>
            <SelectOption value='all' text={t('maps.page.allSeasons', 'All seasons')} />
            {typeSeasons.seasonIds.map(id => (
              <SelectOption key={id} value={id} text={seasonName(id)} />
            ))}
          </SeasonSelect>
        </MatchupsControls>
      </MatchupsHeader>
      {body}
      <Footnote>
        {isOneVsOne
          ? t('maps.page.matchupsFootnote', 'Ranked games of at least 2 minutes.')
          : t(
              'maps.page.compositionsFootnote',
              'Ranked games of at least 2 minutes. Each race combination counts every game it ' +
                'played on this map, best winrate first. The line marks 50%.',
            )}
      </Footnote>
    </MatchupsCard>
  )
}

function GamesCount({ games }: { games: number }) {
  const { t } = useTranslation()
  return t('maps.page.matchupGames', {
    defaultValue: '{{count}} games',
    defaultValue_one: '{{count}} game',
    count: games,
  })
}

function OneVsOneMatchupRow({
  row,
  allSeasons,
}: {
  row: MapMatchupCounts & { medianLength?: number | null }
  /** Whether the row sums every season, which makes its length a typical rather than a median. */
  allSeasons: boolean
}) {
  const { t } = useTranslation()
  const percent = useFormat(percentFormat)
  const [left, right] = row.matchup.split('-')
  const rates = matchupWinRates(row)
  const label = <MatchupLabel>{matchupLabel(row.matchup)}</MatchupLabel>

  if (isMirrorMatchup(row.matchup)) {
    return (
      <MatchupRow>
        {label}
        <MatchupSubtext>
          <GamesCount games={row.games} />
        </MatchupSubtext>
      </MatchupRow>
    )
  }

  if (!rates) {
    return (
      <MatchupRow>
        {label}
        <NotEnoughGames>
          {t('maps.page.notEnoughGames', {
            defaultValue: '{{count}} games, not enough for a winrate yet',
            defaultValue_one: '{{count}} game, not enough for a winrate yet',
            count: row.games,
          })}
        </NotEnoughGames>
      </MatchupRow>
    )
  }

  const length =
    row.medianLength !== null && row.medianLength !== undefined
      ? getGameDurationString(row.medianLength)
      : undefined

  return (
    <MatchupRow>
      {label}
      <Bar
        role='img'
        aria-label={t('maps.page.matchupBarLabel', {
          defaultValue: '{{left}} {{leftRate}}, {{right}} {{rightRate}}',
          left: left.toUpperCase(),
          leftRate: percent.format(rates.left),
          right: right.toUpperCase(),
          rightRate: percent.format(rates.right),
        })}>
        <BarSegment
          style={{
            width: `${rates.left * 100}%`,
            backgroundColor: getRaceColor(left as RaceChar),
          }}
        />
        <BarSegment style={{ flexGrow: 1, backgroundColor: getRaceColor(right as RaceChar) }} />
      </Bar>
      <MatchupNumbers>
        <span>
          {percent.format(rates.left)} · {percent.format(rates.right)}
        </span>
        <MatchupSubtext>
          <GamesCount games={row.games} />
          {length ? (
            <>
              {' · '}
              {allSeasons
                ? t('maps.page.typicalLength', {
                    defaultValue: '{{length}} typical',
                    length,
                  })
                : t('maps.page.medianLength', {
                    defaultValue: '{{length}} median',
                    length,
                  })}
            </>
          ) : null}
        </MatchupSubtext>
      </MatchupNumbers>
    </MatchupRow>
  )
}

function CompositionRow({
  composition,
  games,
  winRate,
}: {
  composition: string
  games: number
  winRate: number | undefined
}) {
  const { t } = useTranslation()
  const percent = useFormat(percentFormat)
  const label = (
    <MatchupLabel aria-label={composition.toUpperCase()}>
      <RaceIcons composition={composition} />
    </MatchupLabel>
  )

  if (winRate === undefined) {
    return (
      <MatchupRow>
        {label}
        <NotEnoughGames>
          {t('maps.page.notEnoughGames', {
            defaultValue: '{{count}} games, not enough for a winrate yet',
            defaultValue_one: '{{count}} game, not enough for a winrate yet',
            count: games,
          })}
        </NotEnoughGames>
      </MatchupRow>
    )
  }

  return (
    <MatchupRow>
      {label}
      <Bar role='img' aria-label={percent.format(winRate)}>
        <BarSegment
          style={{ width: `${winRate * 100}%`, backgroundColor: 'var(--theme-primary)' }}
        />
        <EvenMarker />
      </Bar>
      <MatchupNumbers>
        <span>{percent.format(winRate)}</span>
        <MatchupSubtext>
          <GamesCount games={games} />
        </MatchupSubtext>
      </MatchupNumbers>
    </MatchupRow>
  )
}
