import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { getGameDurationString } from '../../common/games/games'
import {
  getDivisionContext,
  makeSeasonId,
  MatchmakingDivision,
  MatchmakingType,
  matchmakingTypeToLabel,
} from '../../common/matchmaking'
import { SbUserId } from '../../common/users/sb-user-id'
import { FragmentType, graphql, useFragment } from '../gql'
import { useNow } from '../react/date-hooks'
import { useAppSelector } from '../redux-hooks'
import { GameCardLayout, GameCardPlayer, GameCardSize } from './game-card'
import { loadMatchmakingSeasons } from './game-link-card'
import { getCurrentDivision } from './live-game-entry'

export const GamesBrowse_LiveGameFragment = graphql(/* GraphQL */ `
  fragment GamesBrowse_LiveGameFragment on Game {
    id
    startTime
    map {
      id
      name
      mapFile {
        id
        image256Url
        image512Url
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
            name
          }
          race
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
  }
`)

/** A card for a game in progress, from the live games feed. */
export function LiveGameCard({
  query,
  size,
  onOpen,
}: {
  query: FragmentType<typeof GamesBrowse_LiveGameFragment>
  size: GameCardSize
  onOpen: (gameId: string) => void
}) {
  const { t } = useTranslation()
  const game = useFragment(GamesBrowse_LiveGameFragment, query)
  // The elapsed time only shows minutes, so a minute's resolution is enough.
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

  const divisionContext = season ? getDivisionContext(new Date(now), season) : undefined
  const divisionById = new Map<SbUserId, MatchmakingDivision>(
    divisionContext
      ? game.currentRanks.map(rank => [rank.userId, getCurrentDivision(rank, divisionContext)])
      : [],
  )

  const toCardPlayer = (p: (typeof game.config.teams)[number][number]): GameCardPlayer => ({
    userId: p.user?.id,
    name: p.user?.name ?? t('game.playerName.unknown', 'Unknown player'),
    race: p.race,
    division: p.user ? divisionById.get(p.user.id) : undefined,
  })

  const matchmakingType = game.config.gameSourceExtra.matchmakingType
  // A 1v1's players are all in the first team, so each one becomes a side of their own.
  const sides =
    matchmakingType === MatchmakingType.Match1v1 ||
    matchmakingType === MatchmakingType.Match1v1Fastest
      ? game.config.teams[0].map(p => [toCardPlayer(p)])
      : game.config.teams.map(team => team.map(toCardPlayer))

  const startTime = new Date(game.startTime).getTime()
  const mapFile = game.map?.mapFile

  return (
    <GameCardLayout
      size={size}
      mapImageUrl={
        size === 'large' ? (mapFile?.image512Url ?? mapFile?.image256Url) : mapFile?.image256Url
      }
      mapName={game.map?.name ?? t('game.mapName.unknown', 'Unknown map')}
      modeLabel={t('game.gameSource.ranked', {
        defaultValue: `Ranked {{matchmakingType}}`,
        matchmakingType: matchmakingTypeToLabel(matchmakingType, t),
      })}
      live={true}
      sides={sides}
      lengthText={getGameDurationString(Math.max(0, now - startTime))}
      actionLabel={t('games.card.openLive', 'Open this live game')}
      onClick={() => onOpen(game.id)}
      onDoubleClick={() => onOpen(game.id)}
    />
  )
}
