import { useTranslation } from 'react-i18next'
import { SbUserId } from '../../common/users/sb-user-id'
import { closeDialog } from '../dialogs/action-creators'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { DialogType } from '../dialogs/dialog-type'
import { TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { BodyLarge } from '../styles/typography'
import { adminRemoveUserAvatar } from './action-creators'

export interface RemoveUserAvatarDialogProps extends CommonDialogProps {
  userId: SbUserId
}

export function RemoveUserAvatarDialog({ onCancel, userId }: RemoveUserAvatarDialogProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const snackbarController = useSnackbarController()
  const user = useAppSelector(s => s.users.byId.get(userId))

  const onConfirmClick = () => {
    dispatch(
      adminRemoveUserAvatar(userId, {
        onSuccess: () => {
          snackbarController.showSnackbar(t('users.profile.admin.avatarRemoved', 'Avatar removed'))
          dispatch(closeDialog(DialogType.RemoveUserAvatar))
        },
        onError: () => {
          snackbarController.showSnackbar(
            t('users.profile.admin.avatarRemoveError', 'There was a problem removing the avatar'),
          )
        },
      }),
    )
  }

  const buttons = [
    <TextButton label={t('common.actions.cancel', 'Cancel')} key='cancel' onClick={onCancel} />,
    <TextButton
      label={t('users.profile.admin.removeAvatarAction', 'Remove avatar')}
      key='remove'
      onClick={onConfirmClick}
    />,
  ]

  return (
    <Dialog
      title={t('users.profile.admin.removeAvatarTitle', 'Remove avatar?')}
      buttons={buttons}
      onCancel={onCancel}>
      <BodyLarge>
        {t(
          'users.profile.admin.removeAvatarBody',
          "This will permanently delete {{user}}'s avatar. This can't be undone.",
          { user: user?.name ?? '' },
        )}
      </BodyLarge>
    </Dialog>
  )
}
