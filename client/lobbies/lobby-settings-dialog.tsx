import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { GameType, gameTypeToLabel, isTeamType } from '../../common/games/game-type'
import { hasObservers } from '../../common/lobbies'
import { UpdateLobbySettingsRequest } from '../../common/lobbies/lobby-network'
import { SbMapId } from '../../common/maps'
import { range } from '../../common/range'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { useForm, useFormCallbacks } from '../forms/form-hook'
import { ReduxMapThumbnail } from '../maps/map-thumbnail'
import { TextButton } from '../material/button'
import { CheckBox } from '../material/check-box'
import { Dialog } from '../material/dialog'
import { SelectOption } from '../material/select/option'
import { Select } from '../material/select/select'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { bodyLarge } from '../styles/typography'
import { getLobbyPreferences, updateLobbySettings } from './action-creators'

const StyledDialog = styled(Dialog)`
  max-width: 480px;
`

const GameTypeAndSubType = styled.div`
  display: flex;
  flex-direction: row;
  gap: 20px;

  & > * {
    flex-grow: 1;
    flex-basis: 0;
  }
`

const SectionHeader = styled.div`
  ${bodyLarge};
  margin: 20px 0 8px;

  &:first-child {
    margin-top: 0;
  }
`

const MapRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`

const MapOption = styled(ReduxMapThumbnail)`
  width: 88px;
  height: 88px;
  cursor: pointer;
`

const CheckBoxes = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`

interface LobbySettingsModel {
  gameType: GameType
  gameSubType: number
  useLegacyLimits: boolean
  allowObservers: boolean
  mapId: SbMapId
}

/**
 * Host-only dialog for editing a gathering lobby's settings (game type/sub-type, map, unit limit,
 * and observers). Only fields that actually changed from the lobby's current values are sent to
 * the server on save.
 */
export function LobbySettingsDialog({ onCancel, close }: CommonDialogProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const lobby = useAppSelector(s => s.lobby.info)
  const recentMapIds = useAppSelector(s => s.lobbyPreferences.recentMaps)

  useEffect(() => {
    dispatch(getLobbyPreferences())
  }, [dispatch])

  // Captured once when the dialog opens: the values a save should be diffed against, and the
  // form's starting point. The form intentionally doesn't track later changes to the lobby itself
  // while it's open (the host is composing a new set of settings, not watching them shift).
  const initialModel = useMemo<LobbySettingsModel>(
    () => ({
      gameType: lobby.gameType,
      gameSubType: lobby.gameSubType,
      useLegacyLimits: lobby.useLegacyLimits,
      allowObservers: hasObservers(lobby),
      mapId: lobby.map!.id,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see comment above, captured once only
    [],
  )

  const { bindCustom, bindCheckable, getInputValue, setInputValue, form, submit } =
    useForm<LobbySettingsModel>(initialModel, {})

  useFormCallbacks(form, {
    onSubmit: model => {
      const settings: Partial<Omit<UpdateLobbySettingsRequest, 'clientId'>> = {}
      if (model.mapId !== initialModel.mapId) {
        settings.map = model.mapId
      }
      if (model.gameType !== initialModel.gameType) {
        settings.gameType = model.gameType
      }
      if (model.gameSubType !== initialModel.gameSubType) {
        settings.gameSubType = model.gameSubType
      }
      if (model.useLegacyLimits !== initialModel.useLegacyLimits) {
        settings.useLegacyLimits = model.useLegacyLimits
      }
      if (model.allowObservers !== initialModel.allowObservers) {
        settings.allowObservers = model.allowObservers
      }

      if (Object.keys(settings).length > 0) {
        dispatch(updateLobbySettings(settings))
      }
      close()
    },
  })

  const gameType = getInputValue('gameType')
  const mapId = getInputValue('mapId')
  const selectedMapInfo = useAppSelector(s => s.maps.byId.get(mapId))

  useEffect(() => {
    if (!selectedMapInfo || !isTeamType(gameType)) {
      return
    }

    const subType = getInputValue('gameSubType')
    const {
      mapData: { slots },
    } = selectedMapInfo

    // Ensure that the game sub-type is always valid for the selected map. The lower bound matters
    // when the lobby's current game type has no sub-type at all (its value is 0), which every team
    // type's options start above.
    if (gameType === GameType.TopVsBottom) {
      const maxTopSlots = slots - 1
      if (subType < 1 || subType > maxTopSlots) {
        setInputValue('gameSubType', Math.min(maxTopSlots, Math.max(1, subType)))
      }
    } else {
      const maxTeams = Math.min(4, slots)
      if (subType < 2 || subType > maxTeams) {
        setInputValue('gameSubType', Math.min(maxTeams, Math.max(2, subType)))
      }
    }
  }, [gameType, selectedMapInfo, getInputValue, setInputValue])

  let gameSubTypeSelection: React.ReactNode
  if (!isTeamType(gameType) || !selectedMapInfo) {
    gameSubTypeSelection = null
  } else {
    const {
      mapData: { slots },
    } = selectedMapInfo
    if (gameType === GameType.TopVsBottom) {
      gameSubTypeSelection = (
        <Select
          {...bindCustom('gameSubType')}
          label={t('lobbies.createLobby.gameSubTypeHeader', 'Teams')}
          tabIndex={0}>
          {Array.from(range(slots - 1, 0), top => (
            <SelectOption
              key={top}
              value={top}
              text={t('lobbies.createLobby.gameSubTypeOptionTvB', {
                defaultValue: '{{topSlots}} vs {{bottomSlots}}',
                topSlots: top,
                bottomSlots: slots - top,
              })}
            />
          ))}
        </Select>
      )
    } else {
      gameSubTypeSelection = (
        <Select
          {...bindCustom('gameSubType')}
          label={t('lobbies.createLobby.gameSubTypeHeader', 'Teams')}
          tabIndex={0}>
          {Array.from(range(2, Math.min(slots, 4) + 1), numTeams => (
            <SelectOption
              key={numTeams}
              value={numTeams}
              text={t('lobbies.createLobby.gameSubTypeOption', {
                defaultValue: '{{numTeams}} teams',
                numTeams,
              })}
            />
          ))}
        </Select>
      )
    }
  }

  const mapOptionIds = Array.from(new Set([initialModel.mapId, ...recentMapIds]))

  const buttons = [
    <TextButton label={t('common.actions.cancel', 'Cancel')} key='cancel' onClick={onCancel} />,
    <TextButton label={t('common.actions.save', 'Save')} key='save' onClick={submit} />,
  ]

  return (
    <StyledDialog
      title={t('lobbies.lobbySettings.title', 'Lobby settings')}
      buttons={buttons}
      onCancel={onCancel}>
      <form noValidate={true} onSubmit={submit}>
        <GameTypeAndSubType>
          <Select
            {...bindCustom('gameType')}
            label={t('lobbies.createLobby.gameTypeHeader', 'Game type')}
            tabIndex={0}>
            {Object.values(GameType).map(type => (
              <SelectOption key={type} value={type} text={gameTypeToLabel(type, t)} />
            ))}
          </Select>
          {gameSubTypeSelection}
        </GameTypeAndSubType>

        <SectionHeader>{t('lobbies.createLobby.selectMap', 'Select map')}</SectionHeader>
        <MapRow>
          {mapOptionIds.map(id => (
            <MapOption
              key={id}
              mapId={id}
              forceAspectRatio={1}
              size={88}
              isSelected={id === mapId}
              onClick={() => setInputValue('mapId', id)}
            />
          ))}
        </MapRow>

        <SectionHeader>
          {t('lobbies.createLobby.advancedSettings', 'Advanced settings')}
        </SectionHeader>
        <CheckBoxes>
          <CheckBox
            {...bindCheckable('useLegacyLimits')}
            label={t('lobbies.createLobby.useLegacyLimits', 'Use legacy unit limit')}
            inputProps={{ tabIndex: 0 }}
          />
          <CheckBox
            {...bindCheckable('allowObservers')}
            label={t('lobbies.createLobby.allowObservers', 'Allow observers')}
            inputProps={{ tabIndex: 0 }}
          />
        </CheckBoxes>
      </form>
    </StyledDialog>
  )
}
