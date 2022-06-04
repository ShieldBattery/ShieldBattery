import { ReplayHeader, ReplayPlayer } from 'jssuh'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import styled from 'styled-components'
import { getGameDurationStr } from '../../common/games/games'
import { TypedIpcRenderer } from '../../common/ipc'
import { MapInfoJson } from '../../common/maps'
import { replayGameTypeToLabel, replayRaceToChar } from '../../common/replays'
import { closeOverlay } from '../activities/action-creators'
import { FileBrowser } from '../file-browser/file-browser'
import {
  ExpansionPanelProps,
  FileBrowserFileEntry,
  FileBrowserFileEntryConfig,
  FileBrowserRootFolderId,
  FileBrowserType,
} from '../file-browser/file-browser-types'
import Replay from '../icons/material/ic_movie_black_24px.svg'
import { RaceIcon } from '../lobbies/race-icon'
import { MapNoImage } from '../maps/map-image'
import { MapThumbnail } from '../maps/map-thumbnail'
import { RaisedButton } from '../material/button'
import { shadow2dp } from '../material/shadows'
import { useAppDispatch } from '../redux-hooks'
import { useStableCallback } from '../state-hooks'
import { background400, colorTextSecondary } from '../styles/colors'
import { headline6, overline, singleLine, subtitle1 } from '../styles/typography'
import { startReplay } from './action-creators'

const ipcRenderer = new TypedIpcRenderer()

async function getReplayFolderPath() {
  return [await ipcRenderer.invoke('pathsGetDocumentsPath'), 'Starcraft', 'maps', 'replays'].join(
    '\\',
  )
}

async function getReplayHeader(filePath: string): Promise<ReplayHeader | undefined> {
  return ipcRenderer.invoke('replayParseHeader', filePath)
}

// Most of these styles were copied from game results page, with some minor modifications. I don't
// think it's worth trying to reuse the same components in both places, since their purpose is quite
// different, and they'll probably diverge even more in the future.

const ReplayPanelContainer = styled.div<{ $isLoading: boolean }>`
  width: 100%;
  padding: 16px;
  background-color: ${background400};

  opacity: ${props => (props.$isLoading ? 0.6 : 1)};
  transition: opacity linear 100ms;
`

const InfoContainer = styled.div`
  display: grid;
  grid-auto-flow: row;
  grid-auto-rows: max-content;
  grid-template-columns: repeat(8, 1fr);
  grid-gap: 24px 24px;
`

const PlayerListContainer = styled.div`
  grid-column: 1 / 6;
`

const MapContainer = styled.div`
  grid-column: 6 / 9;
  height: auto;

  text-align: center;
`

const StyledMapThumbnail = styled(MapThumbnail)`
  ${shadow2dp};
`

const MapName = styled.div`
  ${headline6};
  ${singleLine};
  margin-top: 8px;
`

const TeamLabel = styled.div`
  ${overline};
  ${singleLine};

  height: 24px;
  line-height: 24px;
  margin: 0 8px;

  color: ${colorTextSecondary};
`

const PlayerContainer = styled.div`
  width: 100%;
  height: 56px;
  padding: 8px;

  display: flex;
  align-items: center;
  text-align: left;

  & + ${TeamLabel} {
    margin-top: 16px;
  }
`

const RaceRoot = styled.div`
  position: relative;
  width: auto;
  height: 32px;
`

const StyledRaceIcon = styled(RaceIcon)`
  width: auto;
  height: 100%;
`

const PlayerName = styled.div`
  ${headline6};
  ${singleLine};
  margin-left: 16px;
  margin-right: 8px;
  flex-grow: 1;
`

const ReplayInfo = styled.div`
  ${subtitle1};
  ${singleLine};
  margin: 8px 0;

  color: ${colorTextSecondary};
`

const MapNoImageContainer = styled.div`
  position: relative;
  width: 100%;
  height: auto;
  border-radius: 2px;
  contain: content;
`

const ReplayActionsContainer = styled.div`
  display: flex;
  justify-content: flex-end;
  align-items: center;
  width: 100%;
  height: 56px;
`

export function ReplayExpansionPanel({ file }: ExpansionPanelProps) {
  const dispatch = useAppDispatch()
  const [replayHeader, setReplayHeader] = useState<ReplayHeader>()
  const [mapInfo, setMapInfo] = useState<MapInfoJson>()

  useEffect(() => {
    // TODO(2Pac): cache this?
    getReplayHeader(file.path).then(header => setReplayHeader(header))
  }, [file.path])

  const [durationStr, gameTypeLabel, playerListItems] = useMemo(() => {
    if (!replayHeader) {
      return ['00:00', null]
    }

    // TODO(2Pac): Handle replays not played at the fastest speed (if that's even possible?)
    const timeMs = (replayHeader.durationFrames / 24) * 1000
    const durationStr = getGameDurationStr(timeMs)
    const gameTypeLabel = replayGameTypeToLabel(replayHeader.gameType)

    const teams = replayHeader.players.reduce((acc, player) => {
      const team = acc.get(player.team)
      if (team) {
        team.push(player)
      } else {
        acc.set(player.team, [player])
      }
      return acc
    }, new Map<number, ReplayPlayer[]>())

    const playerListItems = Array.from(teams.values(), (team, i) => {
      const elems = team.map((player, j) => (
        <PlayerContainer key={player.id}>
          <RaceRoot>
            <StyledRaceIcon race={replayRaceToChar(player.race)} />
          </RaceRoot>
          <PlayerName>{player.isComputer ? 'Computer' : player.name}</PlayerName>
        </PlayerContainer>
      ))

      if (teams.size > 1) {
        elems.unshift(<TeamLabel key={`team-${i}`}>{'Team ' + (i + 1)}</TeamLabel>)
      }

      return elems
    })

    return [durationStr, gameTypeLabel, playerListItems]
  }, [replayHeader])

  const onStartReplay = useStableCallback(() => {
    dispatch(closeOverlay() as any)
    dispatch(startReplay(file))
  })

  return (
    <ReplayPanelContainer $isLoading={!replayHeader}>
      <InfoContainer>
        <PlayerListContainer>{playerListItems}</PlayerListContainer>
        <MapContainer>
          {mapInfo ? (
            <StyledMapThumbnail map={mapInfo} />
          ) : (
            <MapNoImageContainer>
              <MapNoImage />
            </MapNoImageContainer>
          )}
          <MapName>{replayHeader?.mapName ?? 'Unknown map'}</MapName>
          <ReplayInfo>Game type: {gameTypeLabel}</ReplayInfo>
          <ReplayInfo>Duration: {durationStr}</ReplayInfo>
        </MapContainer>
      </InfoContainer>
      <ReplayActionsContainer>
        <RaisedButton label='Watch replay' onClick={onStartReplay} />
      </ReplayActionsContainer>
    </ReplayPanelContainer>
  )
}

export function BrowseLocalReplays() {
  const dispatch = useAppDispatch()
  const [replayFolderPath, setReplayFolderPath] = useState<string>('')

  useEffect(() => {
    getReplayFolderPath().then(path => setReplayFolderPath(path))
  }, [])

  const onStartReplay = useCallback(
    (replay: FileBrowserFileEntry) => {
      dispatch(closeOverlay() as any)
      dispatch(startReplay(replay))
    },
    [dispatch],
  )

  const fileEntryConfig: FileBrowserFileEntryConfig = useMemo(
    () => ({
      icon: <Replay />,
      allowedExtensions: ['rep'],
      ExpansionPanelComponent: ReplayExpansionPanel,
      onSelect: onStartReplay,
      onSelectTitle: 'Watch replay',
    }),
    [onStartReplay],
  )
  const rootFolders = useMemo(
    () => ({
      default: {
        id: FileBrowserRootFolderId.Default,
        name: 'Replays',
        path: replayFolderPath,
      },
    }),
    [replayFolderPath],
  )

  if (!replayFolderPath) {
    return null
  }

  return (
    <FileBrowser
      browserType={FileBrowserType.Replays}
      title='Local Replays'
      rootFolders={rootFolders}
      fileEntryConfig={fileEntryConfig}
    />
  )
}
