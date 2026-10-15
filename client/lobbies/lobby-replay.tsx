import * as React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { getGameDurationString } from '../../common/games/games'
import { MS_PER_GAME_FRAME } from '../../common/games/replay-timestamp'
import { LobbyReplay } from '../../common/lobbies'
import { MapImageInfo } from '../../common/maps'
import { ReplaySessionPlayer } from '../../common/replay-sessions'
import { urlPath } from '../../common/urls'
import { MaterialIcon } from '../icons/material/material-icon'
import { MapInfoImage } from '../maps/map-image'
import { DivisionIcon } from '../matchmaking/rank-icon'
import { LinkButton } from '../material/link-button'
import { bodyMedium, bodySmall, labelLarge, singleLine, titleLarge } from '../styles/typography'
import { RaceIcon } from './race-icon'

/**
 * The name of the map a lobby is about: the map a game lobby plays, or the map of the replay a
 * replay lobby watches.
 */
export function lobbyDisplayMapName(lobby: {
  readonly map?: { readonly name: string }
  readonly replay?: ReadonlyDeep<LobbyReplay>
}): string {
  return lobby.map?.name ?? lobby.replay?.source.metadata.mapName ?? ''
}

const ThumbnailRoot = styled.div`
  width: 100%;
  height: 100%;
  aspect-ratio: 1;

  display: flex;
  align-items: center;
  justify-content: center;

  border-radius: 4px;
  background-color: var(--theme-container-high);
  color: var(--theme-amber);
`

/** Stands in for a map thumbnail on a lobby that watches a replay rather than playing a map. */
export function ReplayThumbnail({
  className,
  mapImage,
}: {
  className?: string
  mapImage?: ReadonlyDeep<MapImageInfo>
}) {
  const { t } = useTranslation()
  if (mapImage?.image512Url) {
    return <MapInfoImage map={mapImage} size={512} forceAspectRatio={1} className={className} />
  }
  return (
    <ThumbnailRoot
      className={className}
      role='img'
      aria-label={t('lobbies.replayLobby.replay', 'Replay')}>
      <MaterialIcon icon='smart_display' size={36} filled={true} />
    </ThumbnailRoot>
  )
}

const Card = styled.div`
  padding: 16px;

  display: flex;
  flex-direction: column;
  gap: 16px;

  border-radius: 8px;
  background-color: var(--theme-container-low);
`

const CardHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`

const CardIcon = styled(MaterialIcon)`
  flex-shrink: 0;
  color: var(--theme-amber);
`

const CardTitles = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
`

const MapName = styled.div`
  ${titleLarge};
  ${singleLine};
`

const Duration = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
`

const Matchup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`

const Versus = styled.div`
  ${labelLarge};
  padding: 2px 0;
  color: var(--theme-on-surface-variant);
`

const PlayerRow = styled.div`
  ${bodyMedium};
  display: flex;
  align-items: center;
  gap: 8px;
`

const PlayerRace = styled(RaceIcon)`
  width: 20px;
  height: 20px;
  flex-shrink: 0;
`

const PlayerName = styled.div`
  ${singleLine};
  min-width: 0;
`

const PlayerProfileLink = styled(LinkButton)`
  ${singleLine};
  min-width: 0;

  &:hover,
  &:focus-visible {
    color: var(--theme-amber);
    text-decoration: underline;
  }
`

const PlayerDivision = styled(DivisionIcon)`
  width: 24px;
  height: 24px;
  flex-shrink: 0;
`

const PlayerMmr = styled.span`
  ${bodySmall};
  margin-left: auto;
  white-space: nowrap;
  color: var(--theme-on-surface-variant);
`

/**
 * Groups players into the sides that faced each other, keeping the order sides first appear in.
 * Melee and free-for-all replays put every player on the same team, which really means everyone
 * played for themselves.
 */
function groupByTeam(
  players: ReadonlyArray<ReplaySessionPlayer>,
): Array<ReadonlyArray<ReplaySessionPlayer>> {
  if (players.every(p => p.team === players[0].team)) {
    return players.map(p => [p])
  }

  const teams = new Map<number, ReplaySessionPlayer[]>()
  for (const player of players) {
    const team = teams.get(player.team)
    if (team) {
      team.push(player)
    } else {
      teams.set(player.team, [player])
    }
  }
  return [...teams.values()]
}

/** Shows the replay a lobby watches: its map, length, and who played it. */
export function ReplayCard({
  mapName,
  durationFrames,
  players,
  children,
}: {
  mapName: string
  durationFrames?: number
  players: ReadonlyArray<ReplaySessionPlayer>
  children?: React.ReactNode
}) {
  const { t } = useTranslation()
  const teams = groupByTeam(players)

  return (
    <Card>
      <CardHeader>
        <CardIcon icon='smart_display' size={32} filled={true} />
        <CardTitles>
          <MapName title={mapName}>{mapName}</MapName>
          {durationFrames !== undefined ? (
            <Duration>
              {t('lobbies.replayLobby.duration', {
                defaultValue: '{{duration}} replay',
                duration: getGameDurationString(durationFrames * MS_PER_GAME_FRAME),
              })}
            </Duration>
          ) : null}
        </CardTitles>
      </CardHeader>
      {teams.length ? (
        <Matchup>
          {teams.map((team, i) => (
            <React.Fragment key={i}>
              {i > 0 ? <Versus>{t('lobbies.replayLobby.versus', 'vs')}</Versus> : null}
              {team.map((player, j) => (
                <PlayerRow key={j}>
                  <PlayerRace race={player.race} />
                  {player.userId ? (
                    <PlayerProfileLink
                      href={urlPath`/users/${player.userId}/${player.name}`}
                      title={player.name}>
                      {player.name}
                    </PlayerProfileLink>
                  ) : (
                    <PlayerName title={player.name}>{player.name}</PlayerName>
                  )}
                  {player.ranked ? (
                    <PlayerDivision division={player.ranked.division} size={24} />
                  ) : null}
                  {player.ranked?.mmr !== undefined ? (
                    <PlayerMmr>
                      {player.ranked.mmr} {t('gameDetails.summary.mmr', 'MMR')}
                    </PlayerMmr>
                  ) : null}
                </PlayerRow>
              ))}
            </React.Fragment>
          ))}
        </Matchup>
      ) : null}
      {children}
    </Card>
  )
}
