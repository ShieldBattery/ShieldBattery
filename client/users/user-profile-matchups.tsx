import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { useQuery } from 'urql'
import { MatchmakingSeasonJson, MatchmakingType, SeasonId } from '../../common/matchmaking'
import { SbUserId } from '../../common/users/sb-user-id'
import { graphql } from '../gql'
import { LoadingDotsArea } from '../progress/dots'
import { bodyLarge } from '../styles/typography'
import { DEFAULT_RATING_BANDS } from './matchup-data'
import { MatchupMatrix, MatchupMatrixState, MatchupScope } from './matchup-matrix'
import { EMPTY_MATCHUP_SOURCE, MatchupModeData, createMatchupSource } from './matchup-source'
import { UserRankedModesQuery } from './ranked-modes-query'
import { useProfileSeasons } from './use-profile-seasons'

const UserMatchupStatsQuery = graphql(/* GraphQL */ `
  query UserMatchupStats($userId: SbUserId!, $matchmakingType: MatchmakingType!) {
    userMatchupStats(userId: $userId, matchmakingType: $matchmakingType) {
      matchmakingType
      ratingBandSize
      minRatingBand
      maxRatingBand
      buckets {
        seasonId
        mapId
        races
        opponentRaces
        ratingBand
        games
        wins
      }
      maps {
        id
        name
        mapFile {
          image256Url
        }
      }
    }
  }
`)

const GlobalMatchupStatsQuery = graphql(/* GraphQL */ `
  query GlobalMatchupStats($matchmakingType: MatchmakingType!) {
    globalMatchupStats(matchmakingType: $matchmakingType) {
      matchmakingType
      ratingBandSize
      minRatingBand
      maxRatingBand
      buckets {
        seasonId
        mapId
        races
        opponentRaces
        ratingBand
        games
        wins
      }
      maps {
        id
        name
        mapFile {
          image256Url
        }
      }
    }
  }
`)

const Container = styled.div`
  padding: 0 24px 24px;
`

/** Stands in for the whole tab when there's nothing to draw (no games, or a failed load). */
const Message = styled.div`
  ${bodyLarge};
  color: var(--theme-on-surface-variant);
  padding: 24px 0;
`

/**
 * The Matchups tab: how the player's team's races fare against the opposing team's.
 *
 * A tab of its own rather than a section of the Stats tab because the mode is the matrix's
 * primary axis -- it decides whether the grid is 3x3, 6x6 or 10x10 -- and Stats is organised as
 * one card per mode, which would have fixed that axis before the matrix ever saw it.
 */
export function UserProfileMatchups({
  userId,
  seasons: allSeasons,
}: {
  userId: SbUserId
  seasons: ReadonlyDeep<Map<SeasonId, MatchmakingSeasonJson>>
}) {
  const { t } = useTranslation()

  // Sourced from the ranked history rather than `profile.ladder`, which only carries the current
  // season: a player who sat this season out has a full history to look at and would otherwise be
  // told they have no ranked games at all.
  const [{ data: modeData, error: modeError }] = useQuery({
    query: UserRankedModesQuery,
    variables: { userId },
  })
  // Most-played first, and that one selected by default: it's what a player came to look at.
  const modes = (modeData?.userRankedModes ?? [])
    .slice()
    .sort((a, b) => b.totalGames - a.totalGames)
    .map(m => m.matchmakingType)
  const [selected, setSelected] = useState<MatchmakingType>()
  const mode = selected !== undefined && modes.includes(selected) ? selected : modes[0]
  const [scope, setScope] = useState<MatchupScope>('mine')

  const { state: seasonsState, seasons: chronologicalSeasons } = useProfileSeasons(allSeasons)

  // Both scopes are separate queries rather than one with a flag, because they're genuinely
  // different work: one is an index scan over a user's games, the other a cached ladder-wide
  // aggregate. Only the visible one runs.
  //
  // `suspense: false` for the same reason the rating history uses it: the client runs with
  // suspense on, so throwing a promise here would blank the tab behind this one fetch, including
  // the controls that are the way out of a slow mode.
  const [{ data: mineData, error: mineError }] = useQuery({
    query: UserMatchupStatsQuery,
    variables: { userId, matchmakingType: mode! },
    pause: mode === undefined || scope !== 'mine',
    context: { suspense: false },
  })
  const [{ data: globalData, error: globalError }] = useQuery({
    query: GlobalMatchupStatsQuery,
    variables: { matchmakingType: mode! },
    pause: mode === undefined || scope !== 'global',
    context: { suspense: false },
  })

  // Checked before the empty-modes case: a failed query also has no modes, and "no ranked games
  // yet" would be a false statement about the player rather than about the load.
  if (modeError) {
    return (
      <Container>
        <Message>
          {t('users.profile.matchups.loadError', 'There was a problem loading matchups.')}
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

  // Held until the seasons land rather than drawn against a partial list: the picker would
  // otherwise offer a played season with no name to show for it.
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
          {t('users.profile.matchups.loadError', 'There was a problem loading matchups.')}
        </Message>
      </Container>
    )
  }

  const stats = scope === 'mine' ? mineData?.userMatchupStats : globalData?.globalMatchupStats
  const error = scope === 'mine' ? mineError : globalError
  // Guarded on the mode as well as on the data: urql keeps the previous mode's result in hand
  // while the next one is in flight, which would otherwise draw one mode's numbers under
  // another's axes for a frame.
  const current = stats?.matchmakingType === mode ? stats : undefined

  let state: MatchupMatrixState = 'loading'
  if (error) state = 'error'
  else if (current) state = 'ready'

  const source = current ? createMatchupSource(current as MatchupModeData) : EMPTY_MATCHUP_SOURCE
  const ratingBands = current
    ? { size: current.ratingBandSize, min: current.minRatingBand, max: current.maxRatingBand }
    : DEFAULT_RATING_BANDS

  // Only seasons this matrix was actually played in, newest first, so the picker never offers one
  // whose grid would be empty.
  const played = new Set(current?.buckets.map(b => b.seasonId))
  const availableSeasons = chronologicalSeasons.filter(s => played.has(s.id)).reverse()

  return (
    <Container>
      <MatchupMatrix
        source={source}
        state={state}
        mode={mode!}
        modes={modes}
        onModeChange={setSelected}
        scope={scope}
        onScopeChange={setScope}
        seasons={availableSeasons}
        ratingBands={ratingBands}
      />
    </Container>
  )
}
