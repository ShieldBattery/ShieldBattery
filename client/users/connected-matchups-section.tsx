import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useQuery } from 'urql'
import { MatchmakingType, isSoloType } from '../../common/matchmaking'
import { SbUserId } from '../../common/users/sb-user-id'
import { graphql } from '../gql'
import { LoadingDotsArea } from '../progress/dots'
import { bodySmall, titleMedium } from '../styles/typography'
import { MatchupModeData, createMatchupSource } from './matchup-source'
import { MatchupsSection } from './matchups-section'

const UserMatchupStatsQuery = graphql(/* GraphQL */ `
  query UserMatchupStats($userId: SbUserId!, $matchmakingType: MatchmakingType!) {
    userMatchupStats(userId: $userId, matchmakingType: $matchmakingType) {
      matchmakingType
      totalGames
      buckets {
        seasonId
        mapId
        races
        opponentRaces
        games
        wins
      }
      maps {
        id
        name
      }
    }
  }
`)

const Section = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 0 0;
`

const Heading = styled.h3`
  ${titleMedium};
  margin: 0;
`

const Message = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
`

/**
 * The matchup matrix for one mode, fetched on demand.
 *
 * Solo modes only, which the caller is expected to have already checked -- the query errors for a
 * team mode rather than returning an empty matrix, since a matchup string can't say which side a
 * player was on without team membership. The guard here is a backstop for that, not the place the
 * decision is made.
 */
export function ConnectedMatchupsSection({
  userId,
  matchmakingType,
  seasons,
}: {
  userId: SbUserId
  matchmakingType: MatchmakingType
  seasons: ReadonlyArray<{ id: number; name: string }>
}) {
  const { t } = useTranslation()

  // `suspense: false` for the same reason the rating history uses it: the client runs with
  // suspense on, so throwing a promise here would blank the whole card behind this one fetch.
  const [{ data, fetching, error }] = useQuery({
    query: UserMatchupStatsQuery,
    variables: { userId, matchmakingType },
    pause: !isSoloType(matchmakingType),
    context: { suspense: false },
  })

  if (!isSoloType(matchmakingType)) return null

  const heading = <Heading>{t('users.profile.stats.matchups', 'Matchups')}</Heading>

  if (error) {
    return (
      <Section>
        {heading}
        <Message>
          {t('users.profile.stats.matchupsLoadError', 'There was a problem loading matchups.')}
        </Message>
      </Section>
    )
  }
  if (fetching && !data) {
    return (
      <Section>
        {heading}
        <LoadingDotsArea />
      </Section>
    )
  }
  if (!data) return null

  const stats = data.userMatchupStats
  if (!stats.totalGames) {
    return (
      <Section>
        {heading}
        <Message>
          {t('users.profile.stats.noMatchupGames', 'No games with a recorded matchup yet.')}
        </Message>
      </Section>
    )
  }

  const modeData: MatchupModeData = {
    matchmakingType: stats.matchmakingType,
    totalGames: stats.totalGames,
    buckets: stats.buckets,
    maps: stats.maps,
  }

  // Only seasons this mode was actually played in, newest first, matching the rating chart's
  // season picker rather than offering seasons whose matrix would be empty.
  const played = new Set(modeData.buckets.map(b => b.seasonId))
  const availableSeasons = seasons.filter(s => played.has(s.id)).reverse()

  return (
    <Section>
      {heading}
      <MatchupsSection
        source={createMatchupSource([modeData])}
        modes={[matchmakingType]}
        seasons={availableSeasons}
      />
    </Section>
  )
}
