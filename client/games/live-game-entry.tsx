import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import {
  getTotalBonusPoolForSeason,
  isSoloType,
  makeSeasonId,
  MatchmakingDivision,
  matchmakingDivisionToLabel,
  MatchmakingType,
  matchmakingTypeToLabel,
  NUM_PLACEMENT_MATCHES,
  pointsToMatchmakingDivision,
} from '../../common/matchmaking'
import { SbUserId } from '../../common/users/sb-user-id'
import { FragmentType, graphql, useFragment } from '../gql'
import { NarrowDuration } from '../i18n/date-formats'
import { RaceIcon } from '../lobbies/race-icon'
import { UploadedMapImage } from '../maps/map-image'
import { DivisionIcon } from '../matchmaking/rank-icon'
import { useButtonState } from '../material/button'
import { LinkButton } from '../material/link-button'
import { Ripple } from '../material/ripple'
import { elevationPlus1 } from '../material/shadows'
import { Tooltip } from '../material/tooltip'
import { useNow } from '../react/date-hooks'
import { useAppSelector } from '../redux-hooks'
import { bodySmall, singleLine, titleSmall } from '../styles/typography'
import { getGameResultsUrl } from './action-creators'
import { loadMatchmakingSeasons } from './game-link-card'

/**
 * Shared fragment for the "live games" feed query. Defined here (rather than duplicated in each
 * consumer) so codegen sees a single definition -- two byte-identical copies happen to compile, but
 * the first edit to one breaks `pnpm gen-graphql` with a duplicate-fragment-name error.
 */
export const LiveGames_FeedFragment = graphql(/* GraphQL */ `
  fragment LiveGames_FeedFragment on Query {
    liveGames {
      id
      ...LiveGames_FeedEntryFragment
    }
  }
`)

const LiveGames_FeedEntryFragment = graphql(/* GraphQL */ `
  fragment LiveGames_FeedEntryFragment on Game {
    id
    startTime
    map {
      id
      name
      mapFile {
        id
        image256Url
        image512Url
        image1024Url
        image2048Url
        width
        height
      }
    }
    config {
      __typename

      ... on GameConfigDataMatchmaking {
        gameSourceExtra {
          matchmakingType
        }
        teams {
          user {
            id
          }
          ...LiveGames_FeedEntryPlayersFragment
        }
      }
    }

    currentRanks {
      id
      userId
      matchmakingType
      seasonId
      points
      lifetimeGames
    }

    ...LiveGames_FeedEntryMapAndTypeFragment
  }
`)

/**
 * Returns the division a player is in from their current standing in a mode: unrated until they've
 * finished their placement matches, then placed by their points against the season's bonus pool.
 */
export function getCurrentDivision(
  rank: Readonly<{ matchmakingType: MatchmakingType; points: number; lifetimeGames: number }>,
  bonusPool: number,
): MatchmakingDivision {
  if (rank.lifetimeGames < NUM_PLACEMENT_MATCHES) {
    return MatchmakingDivision.Unrated
  }
  return pointsToMatchmakingDivision(isSoloType(rank.matchmakingType), rank.points, bonusPool)
}

const EntryRoot = styled(LinkButton)`
  position: relative;
  height: 120px;
  padding: 8px;

  display: grid;
  grid-template-columns: minmax(auto, max-content) minmax(25%, 1fr) minmax(25%, 1fr);
  align-items: center;
  justify-items: start;

  column-gap: 16px;

  border-radius: inherit;
  contain: content;
`

// Need this for the tooltip to be positioned correctly
const TimestampContainer = styled.div`
  position: absolute;
  top: 2px;
  right: 6px;
`

const Timestamp = styled(NarrowDuration)`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
`

const Team = styled.div`
  width: 100%;

  display: flex;
  flex-direction: column;
  overflow: hidden;

  gap: 4px;
`

const OneTeam = styled(Team)`
  grid-column: span 2;
`

export function LiveGameEntry({
  query,
  className,
}: {
  query: FragmentType<typeof LiveGames_FeedEntryFragment>
  className?: string
}) {
  const game = useFragment(LiveGames_FeedEntryFragment, query)
  const [buttonProps, rippleRef] = useButtonState({})
  const now = useNow(60_000)

  // Every rank in a game is from the season the game started in.
  const seasonId = game.currentRanks.length
    ? makeSeasonId(game.currentRanks[0].seasonId)
    : undefined
  const season = useAppSelector(s =>
    seasonId !== undefined ? s.matchmakingSeasons.byId.get(seasonId) : undefined,
  )
  const needsSeasons = seasonId !== undefined && season === undefined
  useEffect(() => {
    if (needsSeasons) {
      loadMatchmakingSeasons().catch(swallowNonBuiltins)
    }
  }, [needsSeasons])

  if (game.config.__typename !== 'GameConfigDataMatchmaking') {
    return null
  }

  // Divisions are left out until the season (whose bonus pool places points into them) is loaded.
  const bonusPool = season ? getTotalBonusPoolForSeason(new Date(now), season) : undefined
  const divisionById = new Map<SbUserId, MatchmakingDivision>(
    bonusPool !== undefined
      ? game.currentRanks.map(rank => [rank.userId, getCurrentDivision(rank, bonusPool)])
      : [],
  )

  const matchmakingType = game.config.gameSourceExtra.matchmakingType

  // NOTE(tec27): 1v1 puts all players in the first team
  const teamElements =
    matchmakingType === MatchmakingType.Match1v1 ||
    matchmakingType === MatchmakingType.Match1v1Fastest
      ? [
          <OneTeam key='0'>
            {game.config.teams[0].map(p => (
              <PlayerDisplay key={p.user!.id} query={p} division={divisionById.get(p.user!.id)} />
            ))}
          </OneTeam>,
        ]
      : game.config.teams.map((t, i) => (
          <Team key={i}>
            {t.map(p => (
              <PlayerDisplay key={p.user!.id} query={p} division={divisionById.get(p.user!.id)} />
            ))}
          </Team>
        ))

  const startTime = new Date(game.startTime)

  // NOTE(tec27): We know this map image can never be > 256px which is our smallest size image, so
  // we don't track its dimensions. If this is ever not the case we'd probably need to add a
  // ResizeObserver
  return (
    <EntryRoot {...buttonProps} href={getGameResultsUrl(game.id)} className={className}>
      <MapAndTypeDisplay query={game} />
      {teamElements[0]}
      {teamElements[1]}
      <TimestampContainer>
        <Timestamp to={startTime} from={now} tooltipProps={{ position: 'left' }} />
      </TimestampContainer>
      <Ripple ref={rippleRef} />
    </EntryRoot>
  )
}

const LiveGames_FeedEntryPlayersFragment = graphql(/* GraphQL */ `
  fragment LiveGames_FeedEntryPlayersFragment on GamePlayer {
    user {
      id
      name
    }
    race
  }
`)

const PlayerRoot = styled.div`
  height: 24px;
  min-width: 0;
  overflow: hidden;

  display: flex;
  align-items: center;
  gap: 4px;
`

const PlayerName = styled.div`
  ${titleSmall};
  ${singleLine};
  flex-shrink: 1;
  /** The font has a kinda weird alignment at some sizes =/ */
  margin-top: 1px;
`

const PlayerDivisionTooltip = styled(Tooltip)`
  flex-shrink: 0;
  height: 100%;
`

const PlayerDivision = styled(DivisionIcon)`
  width: 24px;
  height: 24px;
`

const PlayerRace = styled(RaceIcon)`
  flex-grow: 0;
  flex-shrink: 0;
  width: auto;
  height: 100%;
  aspect-ratio: 1;
`

function PlayerDisplay({
  query,
  division,
}: {
  query: FragmentType<typeof LiveGames_FeedEntryPlayersFragment>
  /** The player's current division in the game's mode, if known. */
  division?: MatchmakingDivision
}) {
  const { t } = useTranslation()
  const player = useFragment(LiveGames_FeedEntryPlayersFragment, query)

  return (
    <PlayerRoot>
      {division !== undefined ? (
        <PlayerDivisionTooltip
          text={matchmakingDivisionToLabel(division, t)}
          position='top'
          tabIndex={-1}>
          <PlayerDivision division={division} size={24} />
        </PlayerDivisionTooltip>
      ) : null}
      <PlayerRace race={player.race} />
      <PlayerName>{player.user!.name}</PlayerName>
    </PlayerRoot>
  )
}

const LiveGames_FeedEntryMapAndTypeFragment = graphql(/* GraphQL */ `
  fragment LiveGames_FeedEntryMapAndTypeFragment on Game {
    id
    map {
      id
      name
      mapFile {
        id
        image256Url
        image512Url
        image1024Url
        image2048Url
        width
        height
      }
    }
    config {
      __typename

      ... on GameConfigDataMatchmaking {
        gameSourceExtra {
          matchmakingType
        }
      }
    }
  }
`)

const MapAndTypeRoot = styled.div`
  position: relative;
  max-width: 100%;
  min-width: 0;
  height: 100%;
  min-height: 0;

  text-align: center;
`

const MapName = styled.div`
  ${titleSmall};
  ${singleLine};
  position: absolute;
  bottom: 0;
  width: 100%;
  z-index: 2;

  text-shadow: 0 0 4px var(--color-grey-blue10);
`

const GameType = styled.div`
  ${bodySmall};
  position: absolute;
  top: 2px;
  width: 100%;
  z-index: 2;

  text-shadow: 0 0 8px var(--color-grey-blue10);
`

const StyledMapImage = styled(UploadedMapImage)`
  ${elevationPlus1};

  flex-grow: 1;
  flex-shrink: 1;
  min-width: 0;
  max-width: 100%;
  min-height: 0;
  max-height: 100%;

  display: flex;
  align-items: center;
  justify-content: center;

  border-radius: 4px;
  contain: content;

  & > img {
    width: auto;
    max-width: 100%;
  }
`

function MapAndTypeDisplay({
  query,
  mapSize = 256,
}: {
  query: FragmentType<typeof LiveGames_FeedEntryMapAndTypeFragment>
  mapSize?: number
}) {
  const { t } = useTranslation()
  const game = useFragment(LiveGames_FeedEntryMapAndTypeFragment, query)

  if (game.config.__typename !== 'GameConfigDataMatchmaking') {
    return null
  }

  return (
    <MapAndTypeRoot>
      <StyledMapImage map={game.map} size={mapSize} />
      <GameType>{matchmakingTypeToLabel(game.config.gameSourceExtra.matchmakingType, t)}</GameType>
      <MapName>{game.map.name}</MapName>
    </MapAndTypeRoot>
  )
}
