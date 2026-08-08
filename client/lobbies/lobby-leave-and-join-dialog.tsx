import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SbLobbyId } from '../../common/lobbies/sb-lobby-id'
import { closeDialog } from '../dialogs/action-creators'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { DialogType } from '../dialogs/dialog-type'
import { TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { BodyLarge } from '../styles/typography'
import { joinLobby } from './action-creators'
import { leaveCurrentLobbyVariant, LeaveCurrentLobbyVariant } from './leave-current-lobby'
import { lobbyJoinErrorMessage } from './lobby-join-errors'
import { isInLobby } from './lobby-reducer'
import { navigateToLobby } from './lobby-url'

export interface LobbyLeaveAndJoinProps extends CommonDialogProps {
  lobbyId: SbLobbyId
  name?: string
  asObserver?: boolean
  onJoinFailed?: (message: string) => void
}

/**
 * Confirms trading the viewer's current lobby for a different one before actually doing it: the
 * server can only ever seat a client in one lobby at a time, so moving to another one means
 * leaving the one they're in first.
 */
export function LobbyLeaveAndJoinDialog({
  onCancel,
  lobbyId,
  name,
  asObserver,
  onJoinFailed,
}: LobbyLeaveAndJoinProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const snackbarController = useSnackbarController()
  const selfId = useAppSelector(s => s.auth.self!.user.id)
  const inCurrentLobby = useAppSelector(s => isInLobby(s.lobby))
  const currentLobbyInfo = useAppSelector(s => s.lobby.info)
  const currentLobbyName = currentLobbyInfo.name
  const variant = inCurrentLobby
    ? leaveCurrentLobbyVariant(currentLobbyInfo, selfId)
    : LeaveCurrentLobbyVariant.Member
  const [isJoining, setIsJoining] = useState(false)

  const targetName = name ?? t('lobbies.leaveAndJoin.genericLobbyName', 'the new lobby')

  const onConfirmClick = () => {
    setIsJoining(true)

    dispatch(
      joinLobby(
        lobbyId,
        { asObserver, leaveCurrentLobby: true },
        {
          onSuccess: () => {
            dispatch(closeDialog(DialogType.LobbyLeaveAndJoin))
            navigateToLobby(lobbyId, name)
          },
          onError: (err: unknown) => {
            dispatch(closeDialog(DialogType.LobbyLeaveAndJoin))
            const message = lobbyJoinErrorMessage(err, t)
            if (onJoinFailed) {
              onJoinFailed(message)
            } else {
              snackbarController.showSnackbar(message)
            }
          },
        },
      ),
    )
  }

  const title = t('lobbies.leaveAndJoin.dialogTitle', 'Leave your current lobby?')
  let body: string
  switch (variant) {
    case LeaveCurrentLobbyVariant.HostAlone:
      body = t('lobbies.leaveAndJoin.hostAloneBody', {
        defaultValue: 'Joining {{target}} will close {{current}}, since no one else is in it.',
        target: targetName,
        current: currentLobbyName,
      })
      break
    case LeaveCurrentLobbyVariant.HostWithOthers:
      body = t('lobbies.leaveAndJoin.hostBody', {
        defaultValue:
          "You're hosting {{current}}. Joining {{target}} will hand it off to another player.",
        current: currentLobbyName,
        target: targetName,
      })
      break
    case LeaveCurrentLobbyVariant.Member:
      body = t('lobbies.leaveAndJoin.memberBody', {
        defaultValue: 'Joining {{target}} will remove you from {{current}}.',
        target: targetName,
        current: currentLobbyName,
      })
      break
    default:
      body = variant satisfies never
  }

  const buttons = [
    <TextButton
      label={t('common.actions.cancel', 'Cancel')}
      key='cancel'
      onClick={onCancel}
      disabled={isJoining}
    />,
    <TextButton
      label={t('lobbies.leaveAndJoin.confirmAction', 'Leave and join')}
      key='confirm'
      onClick={onConfirmClick}
      disabled={isJoining}
      testName='leave-and-join-button'
    />,
  ]

  return (
    <Dialog title={title} buttons={buttons} onCancel={onCancel}>
      <BodyLarge>{body}</BodyLarge>
    </Dialog>
  )
}
