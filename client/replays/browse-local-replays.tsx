import { ReplayHeader, ReplayPlayer } from 'jssuh'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import styled from 'styled-components'
import { getGameDurationStr } from '../../common/games/games'
import { TypedIpcRenderer } from '../../common/ipc'
import {
  replayGameTypeToLabel,
  replayRaceToChar,
  ReplayShieldBatteryData,
} from '../../common/replays'
import { SbUserId } from '../../common/users/sb-user'
import { closeOverlay } from '../activities/action-creators'
import { useCutoffElement } from '../dom/cutoff-element'
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
import { RaisedButton } from '../material/button'
import { shadow2dp } from '../material/shadows'
import { Tooltip } from '../material/tooltip'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
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

async function getReplayShieldBatteryData(
  filePath: string,
): Promise<ReplayShieldBatteryData | undefined> {
  return ipcRenderer.invoke('replayShieldBatteryData', filePath)
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
  margin-top: 8px;
`

const StyledTooltip = styled(Tooltip)`
  width: 100%;
  display: flex;
  justify-content: center;
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
  const [replayShieldBatteryData, setReplayShieldBatteryData] = useState<ReplayShieldBatteryData>()
  const gameId = replayShieldBatteryData?.gameId
  const replayUserIds = replayShieldBatteryData?.userIds
  const gameInfo = useAppSelector(s => s.games.byId.get(gameId ?? ''))
  const mapInfo = useAppSelector(s => s.maps2.byId.get(gameInfo?.mapId ?? ''))
  const usersById = useAppSelector(s => s.users.byId)

  const mapNameRef = useRef<HTMLDivElement>(null)
  const isMapNameCutOff = useCutoffElement(mapNameRef.current)
  const gameTypeRef = useRef<HTMLDivElement>(null)
  const isGameTypeCutOff = useCutoffElement(gameTypeRef.current)

  useEffect(() => {
    getReplayHeader(file.path).then(header => setReplayHeader(header))
    getReplayShieldBatteryData(file.path).then(data => setReplayShieldBatteryData(data))
  }, [file.path])

  useEffect(() => {
    const getGameInfoAbortController = new AbortController()

    if (gameId) {
      dispatch(viewGame(gameId, { signal: getGameInfoAbortController.signal }))
    }

    return () => {
      getGameInfoAbortController.abort()
    }
  }, [gameId, dispatch])

  const [durationStr, gameTypeLabel, mapName, playerListItems] = useMemo(() => {
    if (!replayHeader) {
      return ['00:00', 'Unknown', 'Unknown map', null]
    }

    // TODO(2Pac): Handle replays not played at the fastest speed (if that's even possible?)
    const timeMs = (replayHeader.durationFrames / 24) * 1000
    const durationStr = getGameDurationStr(timeMs)
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
  }, [mapInfo?.name, replayHeader, replayUserIds, usersById])

  const onStartReplay = useStableCallback(() => {
    // TODO(2Pac): Remove `any` cast after overlays are TS-ified
    dispatch(closeOverlay() as any)
    dispatch(startReplay(file))
  })

  return (
    <ReplayPanelContainer $isLoading={!replayHeader}>
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
          <StyledTooltip text={mapName} position='bottom' showTooltip={isMapNameCutOff}>
            <MapName ref={mapNameRef}>{mapName}</MapName>
          </StyledTooltip>
          <StyledTooltip text={gameTypeLabel} position='bottom' showTooltip={isGameTypeCutOff}>
            <ReplayInfoText ref={gameTypeRef}>Game type: {gameTypeLabel}</ReplayInfoText>
          </StyledTooltip>
          <ReplayInfoText>Duration: {durationStr}</ReplayInfoText>
        </ReplayInfoContainer>
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
