import React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { MatchmakingType, matchmakingTypeToLabel } from '../../common/matchmaking'
import { getGameResultsUrl } from '../games/action-creators'
import { FragmentType, graphql, useFragment } from '../gql'
import { NarrowDuration } from '../i18n/date-formats'
import { RaceIcon } from '../lobbies/race-icon'
import { UploadedMapImage } from '../maps/map-image'
import { useButtonState } from '../material/button'
import { LinkButton } from '../material/link-button'
import { Ripple } from '../material/ripple'
import { elevationPlus1 } from '../material/shadows'
import { ContainerLevel, containerStyles } from '../styles/colors'
import { bodySmall, singleLine, titleSmall } from '../styles/typography'

export const LiveGames_HomeFeedFragment = graphql(/* GraphQL */ `
  fragment LiveGames_HomeFeedFragment on Query {
    liveGames {
      id
      ...LiveGames_HomeFeedEntryFragment
    }
  }
`)

const Root = styled.div`
  ${containerStyles(ContainerLevel.Low)};
  border-radius: 4px;
`

export function LiveGamesHomeFeed({
  query,
  title,
}: {
  query?: FragmentType<typeof LiveGames_HomeFeedFragment>
  title: React.ReactNode
}) {
  const { liveGames } = useFragment(LiveGames_HomeFeedFragment, query) ?? { liveGames: [] }

  return liveGames.length > 0 ? (
    <>
      {title}
      <Root>
        {liveGames.slice(0, 5).map(liveGame => (
          <LiveGameEntry key={liveGame.id} query={liveGame} />
        ))}
      </Root>
    </>
  ) : null
}

export const LiveGames_HomeFeedEntryFragment = graphql(/* GraphQL */ `
  fragment LiveGames_HomeFeedEntryFragment on Game {
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
      ... on GameConfigDataMatchmaking {
        gameSourceExtra {
          matchmakingType
        }
        teams {
          user {
            id
          }
          ...LiveGames_HomeFeedEntryPlayersFragment
        }
      }
    }

    ...LiveGames_HomeFeedEntryMapAndTypeFragment
  }
`)

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

function LiveGameEntry({ query }: { query: FragmentType<typeof LiveGames_HomeFeedEntryFragment> }) {
  const game = useFragment(LiveGames_HomeFeedEntryFragment, query)
  const [buttonProps, rippleRef] = useButtonState({})
  if (game.config.__typename !== 'GameConfigDataMatchmaking') {
    return null
  }

  const matchmakingType = game.config.gameSourceExtra.matchmakingType

  // NOTE(tec27): 1v1 puts all players in the first team
  const teamElements =
    matchmakingType === MatchmakingType.Match1v1 ||
    matchmakingType === MatchmakingType.Match1v1Fastest
      ? game.config.teams[0].map(p => (
          <Team key={p.user!.id}>
            <PlayerDisplay key={p.user!.id} query={p} />
          </Team>
        ))
      : game.config.teams.map((t, i) => (
          <Team key={i}>
            {t.map(p => (
              <PlayerDisplay key={p.user!.id} query={p} />
            ))}
          </Team>
        ))

  const now = Date.now()
  const startTime = new Date(game.startTime)

  // NOTE(tec27): We know this map image can never be > 256px which is our smallest size image, so
  // we don't track its dimensions. If this is ever not the case we'd probably need to add a
  // ResizeObserver
  return (
    <EntryRoot {...buttonProps} href={getGameResultsUrl(game.id)}>
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

export const LiveGames_HomeFeedEntryPlayersFragment = graphql(/* GraphQL */ `
  fragment LiveGames_HomeFeedEntryPlayersFragment on GamePlayer {
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

const PlayerRace = styled(RaceIcon)`
  flex-grow: 0;
  flex-shrink: 0;
  width: auto;
  height: 100%;
  aspect-ratio: 1;
`

function PlayerDisplay({
  query,
}: {
  query: FragmentType<typeof LiveGames_HomeFeedEntryPlayersFragment>
}) {
  const player = useFragment(LiveGames_HomeFeedEntryPlayersFragment, query)

  return (
    <PlayerRoot>
      <PlayerRace race={player.race} />
      <PlayerName>{player.user!.name}</PlayerName>
    </PlayerRoot>
  )
}

export const LiveGames_HomeFeedEntryMapAndTypeFragment = graphql(/* GraphQL */ `
  fragment LiveGames_HomeFeedEntryMapAndTypeFragment on Game {
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
}: {
  query: FragmentType<typeof LiveGames_HomeFeedEntryMapAndTypeFragment>
}) {
  const { t } = useTranslation()
  const game = useFragment(LiveGames_HomeFeedEntryMapAndTypeFragment, query)

  if (game.config.__typename !== 'GameConfigDataMatchmaking') {
    return null
  }

  return (
    <MapAndTypeRoot>
      <StyledMapImage map={game.map} size={256} />
      <GameType>{matchmakingTypeToLabel(game.config.gameSourceExtra.matchmakingType, t)}</GameType>
      <MapName>{game.map.name}</MapName>
    </MapAndTypeRoot>
  )
}
