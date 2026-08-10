import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { LOBBY_NAME_MAXLENGTH } from '../../../common/constants'
import { hasObservers } from '../../../common/lobbies'
import { UpdateLobbySettingsRequest } from '../../../common/lobbies/lobby-network'
import { SbMapId } from '../../../common/maps'
import { openSimpleDialog } from '../../dialogs/action-creators'
import { CommonDialogProps } from '../../dialogs/common-dialog-props'
import { MaterialIcon } from '../../icons/material/material-icon'
import { BrowseLocalMaps } from '../../maps/browse-local-maps'
import { BrowseServerMaps } from '../../maps/browse-server-maps'
import { TextButton } from '../../material/button'
import { Dialog } from '../../material/dialog'
import { TextField } from '../../material/text-field'
import { useAppDispatch, useAppSelector } from '../../redux-hooks'
import { updateLobbySettings } from '../action-creators'
import { GameSetupForm, GameSetupFormHandle, GameSetupModel } from '../create/game-setup-form'

const StyledDialog = styled(Dialog)`
  max-width: 560px;
`

enum MapBrowseState {
  None,
  Server,
  Local,
}

const BrowseArea = styled.div`
  height: 60vh;
  min-height: 0;

  display: flex;
  flex-direction: column;
  overflow-y: auto;
`

/**
 * Keeps the form mounted (but hidden) while the host browses for a map, so their in-progress edits
 * survive the round trip and the picked map lands in the same form state.
 */
const FormHolder = styled.div<{ $hidden: boolean }>`
  display: ${props => (props.$hidden ? 'none' : 'block')};
`

/**
 * Host-only dialog for editing a gathering lobby's settings (map, game type/sub-type, unit limit,
 * and observers), built on the shared `GameSetupForm`. Only fields that actually changed from the
 * lobby's current values are sent to the server on save. Changing the map swaps the dialog's
 * content to the map browser and back.
 */
export function GameSetupDialog({ onCancel, close }: CommonDialogProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const lobby = useAppSelector(s => s.lobby.info)

  // Captured once when the dialog opens: the values a save should be diffed against, and the
  // form's starting point. The form intentionally doesn't track later changes to the lobby itself
  // while it's open (the host is composing a new set of settings, not watching them shift).
  const [initialModel] = useState<GameSetupModel>(() => ({
    gameType: lobby.gameType,
    gameSubType: lobby.gameSubType,
    useLegacyLimits: lobby.useLegacyLimits,
    allowObservers: hasObservers(lobby),
    mapId: lobby.map!.id,
  }))
  const [initialName] = useState(lobby.name)
  const [name, setName] = useState(initialName)

  const formRef = useRef<GameSetupFormHandle>(null)
  const [browseState, setBrowseState] = useState(MapBrowseState.None)

  const pick = (mapId: SbMapId) => {
    formRef.current?.setMap(mapId)
    setBrowseState(MapBrowseState.None)
  }

  const browsing = browseState !== MapBrowseState.None

  const buttons = browsing
    ? [
        <TextButton
          label={t('common.actions.back', 'Back')}
          iconStart={<MaterialIcon icon='arrow_back' />}
          key='back'
          onClick={() =>
            setBrowseState(
              browseState === MapBrowseState.Local ? MapBrowseState.Server : MapBrowseState.None,
            )
          }
        />,
      ]
    : [
        <TextButton label={t('common.actions.cancel', 'Cancel')} key='cancel' onClick={onCancel} />,
        <TextButton
          label={t('common.actions.save', 'Save')}
          key='save'
          onClick={() => formRef.current?.submit()}
        />,
      ]

  return (
    <StyledDialog
      title={
        browsing
          ? t('lobbies.createLobby.selectMap', 'Select map')
          : t('lobbies.gameSetup.title', 'Game setup')
      }
      buttons={buttons}
      onCancel={onCancel}>
      {browsing ? (
        <BrowseArea>
          {browseState === MapBrowseState.Server ? (
            <BrowseServerMaps
              onMapClick={pick}
              onBrowseLocalMaps={() => setBrowseState(MapBrowseState.Local)}
            />
          ) : (
            <BrowseLocalMaps onMapUpload={pick} />
          )}
        </BrowseArea>
      ) : null}

      <FormHolder $hidden={browsing}>
        <GameSetupForm
          ref={formRef}
          model={initialModel}
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
                    close()
                  },
                  onError: () => {
                    // The dialog stays open with the submitted values, so the host can adjust and retry
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
              close()
            }
          }}
        />
      </FormHolder>
    </StyledDialog>
  )
}
