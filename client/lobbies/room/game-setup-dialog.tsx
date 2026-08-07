import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { hasObservers } from '../../../common/lobbies'
import { UpdateLobbySettingsRequest } from '../../../common/lobbies/lobby-network'
import { openSimpleDialog } from '../../dialogs/action-creators'
import { CommonDialogProps } from '../../dialogs/common-dialog-props'
import { TextButton } from '../../material/button'
import { Dialog } from '../../material/dialog'
import { useAppDispatch, useAppSelector } from '../../redux-hooks'
import { updateLobbySettings } from '../action-creators'
import { GameSetupForm, GameSetupFormHandle, GameSetupModel } from '../create/game-setup-form'

const StyledDialog = styled(Dialog)`
  max-width: 560px;
`

/**
 * Host-only dialog for editing a gathering lobby's settings (map, game type/sub-type, unit limit,
 * and observers), built on the shared `GameSetupForm`. Only fields that actually changed from the
 * lobby's current values are sent to the server on save.
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

  const formRef = useRef<GameSetupFormHandle>(null)

  const buttons = [
    <TextButton label={t('common.actions.cancel', 'Cancel')} key='cancel' onClick={onCancel} />,
    <TextButton
      label={t('common.actions.save', 'Save')}
      key='save'
      onClick={() => formRef.current?.submit()}
    />,
  ]

  return (
    <StyledDialog
      title={t('lobbies.gameSetup.title', 'Game setup')}
      buttons={buttons}
      onCancel={onCancel}>
      <GameSetupForm
        ref={formRef}
        model={initialModel}
        onSubmit={model => {
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
    </StyledDialog>
  )
}
