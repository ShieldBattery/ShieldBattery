import { ReplayHeader, ReplayPlayer } from 'jssuh'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import styled from 'styled-components'
import { getGameDurationString } from '../../common/games/games'
import { TypedIpcRenderer } from '../../common/ipc'
import {
  replayGameTypeToLabel,
  replayRaceToChar,
  ReplayShieldBatteryData,
} from '../../common/replays'
import { SbUserId } from '../../common/users/sb-user'
import { closeOverlay } from '../activities/action-creators'
import { useOverflowingElement } from '../dom/overflowing-element'
import { FileBrowser } from '../file-browser/file-browser'
import {
  ExpansionPanelProps,
  FileBrowserFileEntry,
  FileBrowserFileEntryConfig,
  FileBrowserRootFolderId,
  FileBrowserType,
} from '../file-browser/file-browser-types'
import { viewGame } from '../games/action-creators'
import Replay from '../icons/material/ic_movie_black_24px.svg'
import { RaceIcon } from '../lobbies/race-icon'
import { MapNoImage } from '../maps/map-image'
import { MapThumbnail } from '../maps/map-thumbnail'
import { shadow2dp } from '../material/shadows'
import { Tooltip } from '../material/tooltip'
import { LoadingDotsArea } from '../progress/dots'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { background400, colorError, colorTextSecondary } from '../styles/colors'
import { headline6, overline, singleLine, subtitle1 } from '../styles/typography'
import { startReplay } from './action-creators'

const ipcRenderer = new TypedIpcRenderer()

async function getReplayFolderPath() {
  return [await ipcRenderer.invoke('pathsGetDocumentsPath'), 'Starcraft', 'maps', 'replays'].join(
    '\\',
  )
}

async function getReplayMetadata(
  filePath: string,
): Promise<{ headerData?: ReplayHeader; shieldBatteryData?: ReplayShieldBatteryData } | undefined> {
  return ipcRenderer.invoke('replayParseMetadata', filePath)
}

const ReplayPanelContainer = styled.div`
  width: 100%;
  padding: 16px;
  background-color: ${background400};

  opacity: 1;
  transition: opacity linear 100ms;
`

const ErrorText = styled.div`
  ${subtitle1};
  padding: 16px;

  color: ${colorError};
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

const ReplayInfoContainer = styled.div`
  grid-column: 6 / 9;
  height: auto;

  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
`

const StyledMapThumbnail = styled(MapThumbnail)`
  ${shadow2dp};
`

const MapName = styled.div`
  ${headline6};
  ${singleLine};
  margin: 8px 0;
`

const ReplayInfoText = styled.div`
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

export function ReplayExpansionPanel({ file }: ExpansionPanelProps) {
  const dispatch = useAppDispatch()
  const [replayMetadata, setReplayMetadata] = useState<{
    headerData?: ReplayHeader
    shieldBatteryData?: ReplayShieldBatteryData
  }>()
  const gameId = replayMetadata?.shieldBatteryData?.gameId
  const replayUserIds = replayMetadata?.shieldBatteryData?.userIds
  const gameInfo = useAppSelector(s => s.games.byId.get(gameId ?? ''))
  const mapInfo = useAppSelector(s => s.maps2.byId.get(gameInfo?.mapId ?? ''))
  const usersById = useAppSelector(s => s.users.byId)

  const [mapNameRef, isMapNameOverflowing] = useOverflowingElement()
  const [gameTypeRef, isGameTypeOverflowing] = useOverflowingElement()

  const [parseError, setParseError] = useState(null)

  useEffect(() => {
    getReplayMetadata(file.path)
      .then(data => {
        setParseError(null)
        setReplayMetadata(data)
      })
      .catch(err => setParseError(err))
  }, [file.path])

  useEffect(() => {
    const getGameInfoAbortController = new AbortController()

    if (gameId) {
      dispatch(
        // In case this returns an error, we just default to showing the data from the replay
        // itself. That's why we're not utilizing the `onSuccess`/`onError` handlers here.
        viewGame(gameId, {
          signal: getGameInfoAbortController.signal,
          onSuccess: () => {},
          onError: () => {},
        }),
      )
    }

    return () => {
      getGameInfoAbortController.abort()
    }
  }, [gameId, dispatch])

  const [durationStr, gameTypeLabel, mapName, playerListItems] = useMemo(() => {
    const replayHeader = replayMetadata?.headerData
    if (!replayHeader) {
      return ['00:00', 'Unknown', 'Unknown map', null]
    }

    const timeMs = (replayHeader.durationFrames * 1000) / 24
    const durationStr = getGameDurationString(timeMs)
    const gameTypeLabel = replayGameTypeToLabel(replayHeader.gameType)
    const mapName = mapInfo?.name ?? replayHeader.mapName

    const teams = replayHeader.players.reduce((acc, p) => {
      const team = acc.get(p.team)
      const sbUser = usersById.get((replayUserIds?.[p.id] ?? -1) as SbUserId)
      const player = sbUser ? { ...p, name: sbUser.name } : p
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

    return [durationStr, gameTypeLabel, mapName, playerListItems]
  }, [mapInfo?.name, replayMetadata, replayUserIds, usersById])

  let content
  if (parseError) {
    content = <ErrorText>There was an error parsing the replay</ErrorText>
  } else if (!replayMetadata) {
    content = <LoadingDotsArea />
  } else if (replayMetadata) {
    content = (
      <InfoContainer>
        <PlayerListContainer>{playerListItems}</PlayerListContainer>
        <ReplayInfoContainer>
          {mapInfo ? (
            <StyledMapThumbnail map={mapInfo} />
          ) : (
            <MapNoImageContainer>
              <MapNoImage />
            </MapNoImageContainer>
          )}
          <div>
            <Tooltip text={mapName} position='bottom' disabled={!isMapNameOverflowing}>
              <MapName ref={mapNameRef}>{mapName}</MapName>
            </Tooltip>
            <Tooltip text={gameTypeLabel} position='bottom' disabled={!isGameTypeOverflowing}>
              <ReplayInfoText ref={gameTypeRef}>Game type: {gameTypeLabel}</ReplayInfoText>
            </Tooltip>
            <ReplayInfoText>Duration: {durationStr}</ReplayInfoText>
          </div>
        </ReplayInfoContainer>
      </InfoContainer>
    )
  }

  return <ReplayPanelContainer>{content}</ReplayPanelContainer>
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
