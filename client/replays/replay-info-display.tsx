import { ReplayHeader, ReplayPlayer } from 'jssuh'
import { useEffect, useMemo, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { getGameDurationString } from '../../common/games/games'
import { TypedIpcRenderer } from '../../common/ipc'
import { filterColorCodes } from '../../common/maps'
import {
  ReplayShieldBatteryData,
  replayGameTypeToLabel,
  replayRaceToChar,
} from '../../common/replays'
import { SbUserId } from '../../common/users/sb-user-id'
import { closeDialog } from '../dialogs/action-creators'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { DialogType } from '../dialogs/dialog-type'
import { useOverflowingElement } from '../dom/overflowing-element'
import { viewGame } from '../games/action-creators'
import { RaceIcon } from '../lobbies/race-icon'
import { MapNoImage } from '../maps/map-image'
import { ReduxMapThumbnail } from '../maps/map-thumbnail'
import { TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { elevationPlus1 } from '../material/shadows'
import { Tooltip } from '../material/tooltip'
import { LoadingDotsArea } from '../progress/dots'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { bodyLarge, labelMedium, singleLine, titleLarge } from '../styles/typography'
import { startReplay } from './action-creators'

const ipcRenderer = new TypedIpcRenderer()

async function getReplayMetadata(
  filePath: string,
): Promise<{ headerData?: ReplayHeader; shieldBatteryData?: ReplayShieldBatteryData } | undefined> {
  return ipcRenderer.invoke('replayParseMetadata', filePath)
}

const Root = styled.div``

const ErrorText = styled.div`
  ${bodyLarge};
  padding: 16px;

  color: var(--theme-error);
`

const InfoContainer = styled.div`
  display: grid;
  grid-auto-flow: row;
  grid-auto-rows: max-content;
  grid-template-columns: repeat(8, 1fr);
  grid-gap: 24px 24px;
`

const PlayerListContainer = styled.div`
  grid-column: 4 / 9;
`

const TeamLabel = styled.div`
  ${labelMedium};
  ${singleLine};

  height: 24px;
  line-height: 24px;

  color: var(--theme-on-surface-variant);
`

const PlayerContainer = styled.div`
  width: 100%;
  height: 40px;

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
  aspect-ratio: 1;
`

const PlayerName = styled.div`
  ${titleLarge};
  ${singleLine};
  margin-left: 16px;
  margin-right: 8px;
  flex-grow: 1;
`

const ReplayInfoContainer = styled.div`
  grid-column: 1 / 4;
  height: auto;

  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
`

const StyledMapThumbnail = styled(ReduxMapThumbnail)`
  ${elevationPlus1};
`

const MapNameTooltip = styled(Tooltip)`
  flex-shrink: 0;
`

const MapName = styled.div`
  ${titleLarge};
  ${singleLine};
  margin: 12px 0 16px;
`

const ReplayInfoText = styled.div`
  ${bodyLarge};
  ${singleLine};
  margin: 4px 0;

  color: var(--theme-on-surface-variant);
`

const MapNoImageContainer = styled.div`
  position: relative;
  width: 100%;
  height: auto;
  border-radius: 4px;
  contain: content;
`

const TextInfoContainer = styled.div`
  max-width: 100%;
`

export interface ReplayInfoDisplayProps {
  filePath: string
  className?: string
}

export function ReplayInfoDisplay({ filePath, className }: ReplayInfoDisplayProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const [replayMetadata, setReplayMetadata] = useState<{
    headerData?: ReplayHeader
    shieldBatteryData?: ReplayShieldBatteryData
  }>()
  const gameId = replayMetadata?.shieldBatteryData?.gameId
  const replayUserIds = replayMetadata?.shieldBatteryData?.userIds
  const gameInfo = useAppSelector(s => (gameId ? s.games.byId.get(gameId) : undefined))
  const mapInfo = useAppSelector(s =>
    gameInfo?.mapId ? s.maps.byId.get(gameInfo.mapId) : undefined,
  )
  const usersById = useAppSelector(s => s.users.byId)

  const [mapNameRef, isMapNameOverflowing] = useOverflowingElement()
  const [gameTypeRef, isGameTypeOverflowing] = useOverflowingElement()

  const [parseError, setParseError] = useState(null)

  useEffect(() => {
    getReplayMetadata(filePath)
      .then(data => {
        setParseError(null)
        setReplayMetadata(data)
      })
      .catch(err => setParseError(err))
  }, [filePath])

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
      return [
        '00:00',
        t('game.gameType.unknown', 'Unknown'),
        t('game.mapName.unknown', 'Unknown map'),
        null,
      ]
    }

    const timeMs = (replayHeader.durationFrames * 1000) / 24
    const durationStr = getGameDurationString(timeMs)
    const gameTypeLabel = replayGameTypeToLabel(replayHeader.gameType, t)
    const mapName = filterColorCodes(mapInfo?.name ?? replayHeader.mapName)

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
          <PlayerName>
            {player.isComputer ? t('game.playerName.computer', 'Computer') : player.name}
          </PlayerName>
        </PlayerContainer>
      ))

      if (teams.size > 1) {
        elems.unshift(
          <TeamLabel key={`team-${i}`}>
            {t('game.teamName.number', {
              defaultValue: 'Team {{teamNumber}}',
              teamNumber: i + 1,
            })}
          </TeamLabel>,
        )
      }

      return elems
    })

    return [durationStr, gameTypeLabel, mapName, playerListItems]
  }, [mapInfo?.name, replayMetadata?.headerData, replayUserIds, t, usersById])

  let content
  if (parseError) {
    content = (
      <ErrorText>
        {t('replays.local.loadingError', 'There was a problem loading the replay')}
      </ErrorText>
    )
  } else if (!replayMetadata) {
    content = <LoadingDotsArea />
  } else if (replayMetadata) {
    content = (
      <InfoContainer>
        <ReplayInfoContainer>
          {mapInfo ? (
            <StyledMapThumbnail mapId={mapInfo.id} showInfoLayer />
          ) : (
            <MapNoImageContainer>
              <MapNoImage />
            </MapNoImageContainer>
          )}
          <MapNameTooltip text={mapName} position='bottom' disabled={!isMapNameOverflowing}>
            <MapName ref={mapNameRef}>{mapName}</MapName>
          </MapNameTooltip>
          <TextInfoContainer>
            <Tooltip text={gameTypeLabel} position='bottom' disabled={!isGameTypeOverflowing}>
              <ReplayInfoText ref={gameTypeRef}>
                <Trans t={t} i18nKey='replays.local.gameType'>
                  Game type: {{ gameTypeLabel }}
                </Trans>
              </ReplayInfoText>
            </Tooltip>
            <ReplayInfoText>
              <Trans t={t} i18nKey='replays.local.duration'>
                Duration: {{ durationStr }}
              </Trans>
            </ReplayInfoText>
          </TextInfoContainer>
        </ReplayInfoContainer>
        <PlayerListContainer>{playerListItems}</PlayerListContainer>
      </InfoContainer>
    )
  }

  return <Root className={className}>{content}</Root>
}

const StyledDialog = styled(Dialog)`
  max-width: 800px;
`

interface ReplayInfoDialogProps extends CommonDialogProps {
  filePath: string
}

export function ReplayInfoDialog({ filePath, onCancel }: ReplayInfoDialogProps) {
  const dispatch = useAppDispatch()
  const { t } = useTranslation()

  return (
    <StyledDialog
      onCancel={onCancel}
      title={t('replays.replayInfoDialog.title', 'Replay info')}
      showCloseButton={true}
      buttons={[
        <TextButton key='cancel' onClick={onCancel} label={t('common.actions.cancel', 'Cancel')} />,
        <TextButton
          key='watch'
          onClick={() => {
            dispatch(closeDialog(DialogType.ReplayInfo))
            dispatch(startReplay({ path: filePath }))
          }}
          label={t('replays.replayInfoDialog.watch', 'Watch')}
        />,
      ]}>
      <ReplayInfoDisplay filePath={filePath} />
    </StyledDialog>
  )
}
