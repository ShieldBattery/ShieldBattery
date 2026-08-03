import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { useQuery } from 'urql'
import {
  MatchmakingSeasonJson,
  MatchmakingType,
  NUM_PLACEMENT_MATCHES,
  SeasonId,
} from '../../common/matchmaking'
import { SbUserId } from '../../common/users/sb-user-id'
import { UserProfileJson } from '../../common/users/user-network'
import { graphql } from '../gql'
import { getMatchmakingSeasons } from '../matchmaking/action-creators'
import { LoadingDotsArea } from '../progress/dots'
import { useAppDispatch } from '../redux-hooks'
import { bodyLarge } from '../styles/typography'
import { ConnectedMatchupsSection } from './connected-matchups-section'
import { ModeStatsCard, ModeStatsCardState } from './mode-stats-card'
import { RatingChartPoint, RatingChartSeason } from './rating-chart-data'

const UserRankedModesQuery = graphql(/* GraphQL */ `
  query UserRankedModes($userId: SbUserId!) {
    userRankedModes(userId: $userId) {
      matchmakingType
      totalGames
      wins
      losses
      rating
      delta
    }
  }
`)

const UserRatingHistoryQuery = graphql(/* GraphQL */ `
  query UserRatingHistory($userId: SbUserId!, $matchmakingType: MatchmakingType!) {
    userRatingHistory(userId: $userId, matchmakingType: $matchmakingType) {
      matchmakingType
      totalGames
      downsampled
      points {
        changeDate
        rating
        points
        seasonId
      }
    }
  }
`)

const Container = styled.div`
  padding: 0 24px 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
`

/** Stands in for the whole tab when there's nothing to draw (no games, or a failed load). */
const Message = styled.div`
  ${bodyLarge};
  color: var(--theme-on-surface-variant);
  padding: 24px 0;
`

export function UserProfileStats({
  userId,
  profile,
  seasons,
}: {
  userId: SbUserId
  profile: ReadonlyDeep<UserProfileJson>
  seasons: ReadonlyDeep<Map<SeasonId, MatchmakingSeasonJson>>
}) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()

  // Sourced from the history rather than `profile.ladder`, which only carries the current
  // season: a player who sat this season out has a full history and no current-season rating,
  // and would otherwise be told they have no ranked games at all.
  const [{ data: modeData, error: modeError }] = useQuery({
    query: UserRankedModesQuery,
    variables: { userId },
  })
  // Most-played first, and the first one open by default: it's what a player came to look at.
  const modes = (modeData?.userRankedModes ?? [])
    .slice()
    .sort((a, b) => b.totalGames - a.totalGames)
  // `null` is "untouched, use the default"; `undefined` is "the user closed the open card".
  // They have to be distinguishable: collapsing back to the default would otherwise re-open the
  // first card and start its fetch, and clicking the default card's header would be a no-op.
  const [open, setOpen] = useState<MatchmakingType | undefined | null>(null)
  const openMode = open === null ? modes[0]?.matchmakingType : open

  // The profile request only carries the *current* season, so on a direct load of this tab the
  // store has one entry -- and every season-aware decision in the chart quietly degrades:
  // the line breaks at every boundary, past seasons get no bands, and the season picker and
  // axis collapse to one entry. `/ladder` is the only other thing that fetches the full list,
  // so this tab has to ask for it too. The endpoint is cached server-side.
  const [seasonsState, setSeasonsState] = useState<'loading' | 'ready' | 'error'>('loading')
  useEffect(() => {
    dispatch(
      getMatchmakingSeasons({
        onSuccess: () => setSeasonsState('ready'),
        // The chart is wrong rather than merely empty without the full list, so a failure
        // shows the load error instead of a chart built on one season.
        onError: () => setSeasonsState('error'),
      }),
    )
  }, [dispatch])

  // Chronological: both the splitting and the band grouping walk this in order.
  const chartSeasons: RatingChartSeason[] = Array.from(seasons.values())
    .map(s => ({ id: s.id, name: s.name, startDate: s.startDate, resetMmr: s.resetMmr }))
    .sort((a, b) => a.startDate - b.startDate)

  // Checked before the empty-modes case: a failed query also has no modes, and "no ranked
  // games yet" would be a false statement about the player rather than about the load.
  if (modeError) {
    return (
      <Container>
        <Message>
          {t('users.profile.stats.loadError', 'There was a problem loading this history.')}
        </Message>
      </Container>
    )
  }

  if (!modes.length) {
    return (
      <Container>
        <Message>
          {t('users.profile.stats.noRankedGames', 'This player has no ranked games yet.')}
        </Message>
      </Container>
    )
  }

  // Held until the seasons land rather than drawn against a partial list: a chart built on
  // one season looks plausible and is wrong, which is worse than a moment of loading.
  if (seasonsState === 'loading') {
    return (
      <Container>
        <LoadingDotsArea />
      </Container>
    )
  }
  if (seasonsState === 'error') {
    return (
      <Container>
        <Message>
          {t('users.profile.stats.loadError', 'There was a problem loading this history.')}
        </Message>
      </Container>
    )
  }

  return (
    <Container>
      {modes.map(mode => {
        const type = mode.matchmakingType
        // Current-season figures where the player has them, all-time otherwise -- a mode they
        // haven't touched this season has no current-season record to show, and 0-0 above a
        // chart of a thousand games reads as a bug.
        const current = profile.ladder[type]
        // An unfinished-placements rating is never shown (the card renders a dash instead).
        // The current-season entry needs the lifetimeGames check because the server zeroes
        // its rating during placements; the all-time rating comes back null in that state.
        let rating: number | undefined
        if (current) {
          rating = current.lifetimeGames >= NUM_PLACEMENT_MATCHES ? current.rating : undefined
        } else {
          rating = mode.rating ?? undefined
        }
        return (
          <ConnectedModeStatsCard
            key={type}
            userId={userId}
            matchmakingType={type}
            wins={current?.wins ?? mode.wins}
            losses={current?.losses ?? mode.losses}
            rating={rating}
            seasonDelta={mode.delta ?? undefined}
            seasons={chartSeasons}
            open={openMode === type}
            onToggle={() => setOpen(openMode === type ? undefined : type)}
          />
        )
      })}
    </Container>
  )
}

/** Fetches one mode's history and hands it to the card. */
function ConnectedModeStatsCard({
  userId,
  matchmakingType,
  wins,
  losses,
  rating,
  seasonDelta,
  seasons,
  open,
  onToggle,
}: {
  userId: SbUserId
  matchmakingType: MatchmakingType
  wins: number
  losses: number
  rating?: number
  seasonDelta?: number
  seasons: ReadonlyArray<RatingChartSeason>
  open: boolean
  onToggle: () => void
}) {
  // Only fetch a mode's history once its card is expanded.
  //
  // `suspense: false` because the client runs with suspense on: un-pausing with an empty cache
  // would throw a promise to the nearest boundary, blanking the whole tab behind one card's
  // fetch and skipping the expand animation. The card shows its own loading state instead.
  const [{ data, fetching, error }] = useQuery({
    query: UserRatingHistoryQuery,
    variables: { userId, matchmakingType },
    pause: !open,
    context: { suspense: false },
  })

  const points: RatingChartPoint[] = (data?.userRatingHistory.points ?? []).map(p => ({
    changeDate: Number(new Date(p.changeDate)),
    rating: p.rating,
    points: p.points,
    seasonId: p.seasonId,
  }))

  let state: ModeStatsCardState = 'loading'
  if (error) state = 'error'
  else if (data) state = 'ready'

  return (
    <ModeStatsCard
      matchmakingType={matchmakingType}
      wins={wins}
      losses={losses}
      rating={rating}
      seasonDelta={seasonDelta}
      open={open}
      onToggle={onToggle}
      state={fetching && !data ? 'loading' : state}
      seasons={seasons}
      points={points}
      totalGames={data?.userRatingHistory.totalGames}
      downsampled={data?.userRatingHistory.downsampled}
      // Only fetched once the card is open, since it's rendered inside the expanded body.
      footer={
        open ? (
          <ConnectedMatchupsSection
            userId={userId}
            matchmakingType={matchmakingType}
            seasons={seasons}
          />
        ) : undefined
      }
    />
  )
}
