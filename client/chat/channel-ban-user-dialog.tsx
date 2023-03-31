import React, { useCallback, useState } from 'react'
import styled from 'styled-components'
import { ChannelModerationAction, ChatServiceErrorCode, SbChannelId } from '../../common/chat'
import { SbUserId } from '../../common/users/sb-user'
import { closeDialog } from '../dialogs/action-creators'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { DialogType } from '../dialogs/dialog-type'
import { useForm } from '../forms/form-hook'
import { TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { TextField } from '../material/text-field'
import { FetchError, isFetchError } from '../network/fetch-errors'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { openSnackbar } from '../snackbars/action-creators'
import { colorError } from '../styles/colors'
import { subtitle1 } from '../styles/typography'
import { moderateUser } from './action-creators'
import { useTranslation } from 'react-i18next'

const ErrorsContainer = styled.div`
  margin-bottom: 16px;
`

const ErrorText = styled.span`
  ${subtitle1};
  color: ${colorError};
`

// NOTE(2Pac): We only care about showing a customized message for errors that are actually possible
// to trigger through normal usage of the application. While probably very rare, each of these
// errors are possible in case we/target get kicked out of the channel or have our/theirs
// permissions changed while having this dialog open.
function showBanUserError(user: string, error: FetchError) {
  const { t } = useTranslation()
  switch (error.code) {
    case ChatServiceErrorCode.TargetNotInChannel:
      return <ErrorText>{t('chat.moderation.errorBanTargetNotInChannel', 'The user you are trying to ban is not in channel')}</ErrorText>
    case ChatServiceErrorCode.CannotModerateChannelOwner:
      return <ErrorText>{t('chat.moderation.errorBanChannelOwner', 'You cannot ban channel owner')}</ErrorText>
    case ChatServiceErrorCode.CannotModerateChannelModerator:
      return <ErrorText>{t('chat.moderation.errorBanOtherModerator', 'You cannot ban another moderator')}</ErrorText>
    case ChatServiceErrorCode.NotEnoughPermissions:
      return <ErrorText>{t('chat.moderation.errorBanNotEnoughPermissions', 'You do not have enough permissions to ban this user')}</ErrorText>

    default:
      return <ErrorText>{t('common.errorOccurred', 'An error occurred')}: {error.statusText}</ErrorText>
  }
}

function BanUserErrorDisplay({ user, error }: { user: string; error: Error }) {
  return (
    <ErrorsContainer>
      {isFetchError(error) ? (
        showBanUserError(user, error)
      ) : (
        <ErrorText>
          {t('chat.moderation.errorBanningUser', 'Error banning')} {user}: {error.message}
        </ErrorText>
      )}
    </ErrorsContainer>
  )
}

interface BanUserModel {
  banReason: string
}

export interface ChannelBanUserDialogProps extends CommonDialogProps {
  channelId: SbChannelId
  userId: SbUserId
}

export function ChannelBanUserDialog({
  dialogRef,
  onCancel,
  channelId,
  userId,
}: ChannelBanUserDialogProps) {
  const dispatch = useAppDispatch()
  const user = useAppSelector(s => s.users.byId.get(userId))!
  const [banUserError, setBanUserError] = useState<Error>()

  const onFormSubmit = useCallback(
    (model: BanUserModel) => {
      dispatch(
        moderateUser(
          channelId,
          user.id,
          ChannelModerationAction.Ban,
          {
            onSuccess: () => {
              dispatch(openSnackbar({ message: `${user.name} was banned` }))
              dispatch(closeDialog(DialogType.ChannelBanUser))
            },
            onError: err => setBanUserError(err),
          },
          model.banReason,
        ),
      )
    },
    [channelId, user, dispatch],
  )

  const { onSubmit: handleSubmit, bindInput } = useForm<BanUserModel>(
    { banReason: '' },
    {},
    { onSubmit: onFormSubmit },
  )

  const onBanClick = useCallback(() => handleSubmit(), [handleSubmit])

  const buttons = [
    <TextButton label={t('common.cancel', 'Cancel')} key='cancel' color='accent' onClick={onCancel} />,
    <TextButton label={`Ban ${user.name}`} key='send' color='accent' onClick={onBanClick} />,
  ]

  return (
    <Dialog title={`Ban ${user.name}?`} buttons={buttons} onCancel={onCancel} dialogRef={dialogRef}>
      <form noValidate={true} onSubmit={handleSubmit}>
        {banUserError ? <BanUserErrorDisplay user={user.name} error={banUserError} /> : null}
        <TextField
          {...bindInput('banReason')}
          label='Ban reason (optional)'
          floatingLabel={true}
          inputProps={{
            autoCapitalize: 'off',
            autoCorrect: 'off',
            spellCheck: false,
            tabIndex: 0,
          }}
        />
      </form>
    </Dialog>
  )
}
