import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ReadonlyDeep } from 'type-fest'
import { LOBBY_NAME_MAXLENGTH } from '../../../common/constants'
import { hasObservers } from '../../../common/lobbies'
import { UpdateLobbySettingsRequest } from '../../../common/lobbies/lobby-network'
import { SbMapId } from '../../../common/maps'
import { openSimpleDialog } from '../../dialogs/action-creators'
import { FilledButton, TextButton } from '../../material/button'
import { TextField } from '../../material/text-field'
import { useAppDispatch, useAppSelector } from '../../redux-hooks'
import { getLobbyPreferences, updateLobbySettings } from '../action-creators'
import { GameSetupForm, GameSetupFormHandle, GameSetupModel } from '../create/game-setup-form'
import { formatGameSetupSummary, GameSetupPage, MapBrowseState } from '../create/game-setup-page'

/**
 * The host-only in-page surface for editing a gathering lobby's settings (name, map, game
 * type/sub-type, unit limit, and observers), built on the shared `GameSetupForm`. Only fields that
 * actually changed from the lobby's current values are sent to the server on save.
 */
export function RoomGameSetup({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const lobby = useAppSelector(s => s.lobby.info)
  const recentMaps = useAppSelector(s => s.lobbyPreferences.recentMaps)

  useEffect(() => {
    dispatch(getLobbyPreferences())
  }, [dispatch])

  // Captured once when this mounts: the values a save should be diffed against, and the form's
  // starting point. The form intentionally doesn't track later changes to the lobby itself while
  // it's open (the host is composing a new set of settings, not watching them shift).
  const [initialModel] = useState<GameSetupModel>(() => ({
    gameType: lobby.gameType,
    gameSubType: lobby.gameSubType,
    useLegacyLimits: lobby.useLegacyLimits,
    allowObservers: hasObservers(lobby),
    mapId: lobby.map!.id,
  }))
  const [initialName] = useState(lobby.name)
  const [name, setName] = useState(initialName)
  const [setup, setSetup] = useState<ReadonlyDeep<GameSetupModel>>(initialModel)

  const selectedMapInfo = useAppSelector(s =>
    setup.mapId ? s.maps.byId.get(setup.mapId) : undefined,
  )

  const formRef = useRef<GameSetupFormHandle>(null)
  const [browseState, setBrowseState] = useState(MapBrowseState.None)

  const pick = (mapId: SbMapId) => {
    formRef.current?.setMap(mapId)
    setBrowseState(MapBrowseState.None)
  }

  const summary = formatGameSetupSummary(t, {
    visibility: lobby.visibility,
    setup,
    mapInfo: selectedMapInfo,
  })

  return (
    <GameSetupPage
      title={t('lobbies.gameSetup.title', 'Game setup')}
      onBack={onClose}
      browseState={browseState}
      onBrowseStateChange={setBrowseState}
      onMapPicked={pick}
      summary={summary}
      footerActions={
        <>
          <TextButton label={t('common.actions.cancel', 'Cancel')} onClick={onClose} />
          <FilledButton
            label={t('common.actions.save', 'Save')}
            onClick={() => formRef.current?.submit()}
          />
        </>
      }>
      <GameSetupForm
        ref={formRef}
        model={initialModel}
        recentMaps={recentMaps}
        nameSection={
          <TextField
            value={name}
            onChange={event => setName(event.target.value)}
            floatingLabel={true}
            label={t('lobbies.createLobby.lobbyName', 'Lobby name')}
            testName='lobby-settings-name-input'
            inputProps={{
              maxLength: LOBBY_NAME_MAXLENGTH,
              autoCapitalize: 'off',
              autoComplete: 'off',
              autoCorrect: 'off',
              spellCheck: false,
            }}
          />
        }
        onChangeMap={() => setBrowseState(MapBrowseState.Server)}
        onValidatedChange={model => setSetup(model)}
        onSubmit={model => {
          const settings: Partial<Omit<UpdateLobbySettingsRequest, 'clientId'>> = {}
          const trimmedName = name.trim()
          if (trimmedName && trimmedName !== initialName) {
            settings.name = trimmedName
          }
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
            dispatch(
              updateLobbySettings(settings, {
                onSuccess: () => {
                  onClose()
                },
                onError: () => {
                  // The surface stays open with the submitted values, so the host can adjust and
                  // retry.
                  dispatch(
                    openSimpleDialog(
                      t('lobbies.lobbySettings.errorDialogTitle', 'Error updating settings'),
                      t(
                        'lobbies.lobbySettings.errorGeneric',
                        'The lobby settings could not be updated. The current members may not fit ' +
                          'the new configuration.',
                      ),
                    ),
                  )
                },
              }),
            )
          } else {
            onClose()
          }
        }}
      />
    </GameSetupPage>
  )
}
