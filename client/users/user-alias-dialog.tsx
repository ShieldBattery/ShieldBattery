import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { USERNAME_MAXLENGTH, USERNAME_MINLENGTH, USERNAME_PATTERN } from '../../common/constants'
import { SbUserId } from '../../common/users/sb-user-id'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { useForm, useFormCallbacks, Validator } from '../forms/form-hook'
import { composeValidators, maxLength, minLength, regex, required } from '../forms/validators'
import { useAutoFocusRef } from '../material/auto-focus'
import { TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { TextField } from '../material/text-field'
import { useAppSelector } from '../redux-hooks'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { bodyLarge } from '../styles/typography'
import { setUserAlias, useUserAlias } from './user-aliases'

const StyledDialog = styled(Dialog)`
  max-width: 480px;
`

const Explanation = styled.div`
  ${bodyLarge};
  margin-bottom: 24px;
`

interface AliasFormModel {
  alias: string
}

export interface UserAliasDialogProps extends CommonDialogProps {
  userId: SbUserId
}

/**
 * Lets the logged in user create, change, or remove their alias for another player. Aliases have to
 * be valid usernames, so they fit everywhere a name does (including in games). Several accounts can
 * share an alias, and an alias can be another account's actual name: that's how one player's
 * accounts get linked together under a single name.
 */
export function UserAliasDialog({ onCancel, close, userId }: UserAliasDialogProps) {
  const { t } = useTranslation()
  const snackbarController = useSnackbarController()
  const inputRef = useAutoFocusRef<HTMLInputElement>()
  const user = useAppSelector(s => s.users.byId.get(userId))
  const currentAlias = useUserAlias(userId)

  const notTheirName: Validator<string, AliasFormModel> = (alias, _model, _dirty, t) =>
    user && alias === user.name
      ? t('users.alias.errors.ownName', "That's already their name.")
      : undefined

  const { submit, bindInput, form } = useForm<AliasFormModel>(
    { alias: currentAlias ?? '' },
    {
      alias: composeValidators(
        required(t => t('users.alias.errors.required', 'Enter an alias')),
        minLength(USERNAME_MINLENGTH),
        maxLength(USERNAME_MAXLENGTH),
        regex(USERNAME_PATTERN, t =>
          t('users.alias.errors.pattern', 'Alias contains characters a name can’t'),
        ),
        notTheirName,
      ),
    },
  )

  useFormCallbacks(form, {
    onSubmit: ({ alias }) => {
      setUserAlias(userId, alias)
      snackbarController.showSnackbar(
        t('users.alias.saved', {
          defaultValue: '{{name}} will be shown as {{alias}}',
          name: user?.name ?? '',
          alias,
        }),
      )
      close()
    },
  })

  const onRemove = () => {
    setUserAlias(userId, undefined)
    snackbarController.showSnackbar(
      t('users.alias.removed', {
        defaultValue: 'Removed your alias for {{name}}',
        name: user?.name ?? '',
      }),
    )
    close()
  }

  const buttons = [
    <TextButton label={t('common.actions.cancel', 'Cancel')} key='cancel' onClick={onCancel} />,
    ...(currentAlias !== undefined
      ? [
          <TextButton
            label={t('users.alias.removeAction', 'Remove alias')}
            key='remove'
            onClick={onRemove}
          />,
        ]
      : []),
    <TextButton label={t('common.actions.save', 'Save')} key='save' onClick={submit} />,
  ]

  return (
    <StyledDialog
      title={
        currentAlias !== undefined
          ? t('users.alias.editTitle', 'Edit alias')
          : t('users.alias.createTitle', 'Create alias')
      }
      buttons={buttons}
      onCancel={onCancel}>
      <Explanation>
        {t('users.alias.explanation', {
          defaultValue:
            'Show this alias alongside {{name}} on ShieldBattery, including in games. ' +
            'Only you can see it. You can give the same alias to several accounts.',
          name: user?.name ?? '',
        })}
      </Explanation>
      <form noValidate={true} onSubmit={submit}>
        <TextField
          {...bindInput('alias')}
          label={t('users.alias.label', 'Alias')}
          floatingLabel={true}
          ref={inputRef}
          inputProps={{
            autoCapitalize: 'off',
            autoCorrect: 'off',
            spellCheck: false,
            tabIndex: 0,
            maxLength: USERNAME_MAXLENGTH,
          }}
        />
      </form>
    </StyledDialog>
  )
}
