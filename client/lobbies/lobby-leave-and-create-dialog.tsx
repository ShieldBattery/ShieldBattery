import { useTranslation } from 'react-i18next'
import { closeDialog } from '../dialogs/action-creators'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { DialogType } from '../dialogs/dialog-type'
import { TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { useAppDispatch } from '../redux-hooks'
import { BodyLarge } from '../styles/typography'
import { LeaveCurrentLobbyVariant, useLeaveCurrentLobbyPrompt } from './leave-current-lobby'

export interface LobbyLeaveAndCreateProps extends CommonDialogProps {
  /** Performs the create the form's submit was holding for confirmation. */
  onConfirm: () => void
}

/**
 * Confirms trading the viewer's current lobby for a brand-new one before actually creating it: the
 * server can only ever seat a client in one lobby at a time, so hosting a new one means leaving the
 * one they're in first. Doesn't perform the create itself -- `onConfirm` is the create form's own
 * submit path, picking up from here once the trade is confirmed, with the form's own `isCreating`
 * state and error handling taking it from there.
 */
export function LobbyLeaveAndCreateDialog({ onCancel, onConfirm }: LobbyLeaveAndCreateProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const { variant, currentLobbyName } = useLeaveCurrentLobbyPrompt()

  const onConfirmClick = () => {
    dispatch(closeDialog(DialogType.LobbyLeaveAndCreate))
    onConfirm()
  }

  const title = t('lobbies.leaveAndCreate.dialogTitle', 'Leave your current lobby?')
  let body: string
  switch (variant) {
    case LeaveCurrentLobbyVariant.HostAlone:
      body = t('lobbies.leaveAndCreate.hostAloneNotice', {
        defaultValue: 'Creating this lobby will close {{current}}, since no one else is in it.',
        current: currentLobbyName,
      })
      break
    case LeaveCurrentLobbyVariant.HostWithOthers:
      body = t('lobbies.leaveAndCreate.hostNotice', {
        defaultValue:
          "You're hosting {{current}}. Creating a new lobby will hand it off to another player.",
        current: currentLobbyName,
      })
      break
    case LeaveCurrentLobbyVariant.Member:
      body = t('lobbies.leaveAndCreate.memberNotice', {
        defaultValue: 'Creating this lobby will remove you from {{current}}.',
        current: currentLobbyName,
      })
      break
    default:
      body = variant satisfies never
  }

  const buttons = [
    <TextButton label={t('common.actions.cancel', 'Cancel')} key='cancel' onClick={onCancel} />,
    <TextButton
      label={t('lobbies.leaveAndCreate.confirmAction', 'Leave and create')}
      key='confirm'
      onClick={onConfirmClick}
      testName='leave-and-create-button'
    />,
  ]

  return (
    <Dialog title={title} buttons={buttons} onCancel={onCancel}>
      <BodyLarge>{body}</BodyLarge>
    </Dialog>
  )
}
