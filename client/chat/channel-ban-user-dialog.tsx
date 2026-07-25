import { useCallback, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ChannelModerationAction, ChatServiceErrorCode, SbChannelId } from '../../common/chat'
import { SbUserId } from '../../common/users/sb-user-id'
import { closeDialog } from '../dialogs/action-creators'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { DialogType } from '../dialogs/dialog-type'
import { useForm, useFormCallbacks } from '../forms/form-hook'
import { TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { TextField } from '../material/text-field'
import { FetchError, isFetchError } from '../network/fetch-errors'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { bodyLarge } from '../styles/typography'
import { moderateUser } from './action-creators'

const ErrorsContainer = styled.div`
  margin-bottom: 16px;
`

const ErrorText = styled.span`
  ${bodyLarge};
  color: var(--theme-error);
`

// NOTE(2Pac): We only care about showing a customized message for errors that are actually possible
// to trigger through normal usage of the application. While probably very rare, each of these
// errors are possible in case we/target get kicked out of the channel or have our/theirs
// permissions changed while having this dialog open.
function BanUserError({ user, error }: { user: string; error: FetchError }) {
  const { t } = useTranslation()

  switch (error.code) {
    case ChatServiceErrorCode.TargetNotInChannel:
      return (
        <ErrorText>
          {t(
            'chat.banUserErrorDisplay.notInChannel',
            "The user you're trying to ban is not in this channel",
          )}
        </ErrorText>
      )
    case ChatServiceErrorCode.CannotModerateChannelOwner:
      return (
        <ErrorText>
          {t('chat.banUserErrorDisplay.moderateChannelOwner', 'You cannot ban the channel owner')}
        </ErrorText>
      )
    case ChatServiceErrorCode.CannotModerateChannelModerator:
      return (
        <ErrorText>
          {t(
            'chat.banUserErrorDisplay.moderateChannelModerator',
            'You cannot ban another moderator',
          )}
        </ErrorText>
      )
    case ChatServiceErrorCode.NotEnoughPermissions:
      return (
        <ErrorText>
          {t(
            'chat.banUserErrorDisplay.noPermissions',
            "You don't have enough permissions to ban this user",
          )}
        </ErrorText>
      )

    default:
      return (
        <ErrorText>
          <Trans t={t} i18nKey='chat.banUserErrorDisplay.defaultError'>
            An error occurred: {{ statusText: error.statusText }}
          </Trans>
        </ErrorText>
      )
  }
}

function BanUserErrorDisplay({ user, error }: { user: string; error: Error }) {
  const { t } = useTranslation()
  return (
    <ErrorsContainer>
      {isFetchError(error) ? (
        <BanUserError user={user} error={error} />
      ) : (
        <ErrorText>
          <Trans t={t} i18nKey='chat.banUserErrorDisplay.genericError'>
            Error banning {{ user }}: {{ errorMessage: error.message }}
          </Trans>
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

export function ChannelBanUserDialog({ onCancel, channelId, userId }: ChannelBanUserDialogProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const snackbarController = useSnackbarController()
  const user = useAppSelector(s => s.users.byId.get(userId))!
  const [banUserError, setBanUserError] = useState<Error>()

  const {
    submit: handleSubmit,
    bindInput,
    form,
  } = useForm<BanUserModel>(
    {
      banReason: '',
    },
    {},
  )

  useFormCallbacks(form, {
    onSubmit: model => {
      dispatch(
        moderateUser(
          channelId,
          user.id,
          ChannelModerationAction.Ban,
          {
            onSuccess: () => {
              snackbarController.showSnackbar(
                t('chat.banUser.successMessage', {
                  defaultValue: '{{user}} was banned',
                  user: user.name,
                }),
              )
              dispatch(closeDialog(DialogType.ChannelBanUser))
            },
            onError: err => setBanUserError(err),
          },
          model.banReason,
        ),
      )
    },
  })

  const onBanClick = useCallback(() => handleSubmit(), [handleSubmit])

  const buttons = [
    <TextButton label={t('common.actions.cancel', 'Cancel')} key='cancel' onClick={onCancel} />,
    <TextButton
      label={t('chat.banUser.banAction', { defaultValue: 'Ban {{user}}', user: user.name })}
      key='ban'
      onClick={onBanClick}
    />,
  ]

  return (
    <Dialog
      title={t('chat.banUser.dialogTitle', { defaultValue: 'Ban {{user}}?', user: user.name })}
      buttons={buttons}
      onCancel={onCancel}>
      <form noValidate={true} onSubmit={handleSubmit}>
        {banUserError ? <BanUserErrorDisplay user={user.name} error={banUserError} /> : null}
        <TextField
          {...bindInput('banReason')}
          label={t('chat.banUser.banReason', 'Ban reason (optional)')}
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
