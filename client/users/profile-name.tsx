import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { isValidUsername, USERNAME_MAXLENGTH } from '../../common/constants'
import { SbUser } from '../../common/users/sb-user'
import { useSelfUser } from '../auth/auth-utils'
import { useForm, useFormCallbacks } from '../forms/form-hook'
import { MaterialIcon } from '../icons/material/material-icon'
import { useAutoFocusRef } from '../material/auto-focus'
import { IconButton } from '../material/button'
import { TextField } from '../material/text-field'
import { Tooltip } from '../material/tooltip'
import { CopyLinkButton } from '../navigation/copy-link-button'
import { bodySmall, headlineLarge, singleLine } from '../styles/typography'
import { formatUserAlias, setUserAlias, useUserAlias } from './user-aliases'

const NameRow = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
`

const Name = styled.div`
  ${headlineLarge};
  ${singleLine};
  min-width: 0;
  color: var(--theme-amber);
`

const NameForm = styled.form`
  display: flex;
  align-items: flex-start;
  gap: 4px;
  min-width: 0;
  max-width: 560px;
`

const NameField = styled(TextField)`
  width: 360px;
  min-width: 120px;
  flex-shrink: 1;

  && input[type='text'] {
    ${headlineLarge};
    color: var(--theme-amber);
  }
`

const Hint = styled.div`
  ${bodySmall};
  margin-top: 4px;
  color: var(--theme-on-surface-variant);
`

function NameEditor({
  user,
  initialValue,
  onClose,
}: {
  user: SbUser
  initialValue: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const inputRef = useAutoFocusRef<HTMLInputElement>()
  const { submit, bindInput, form } = useForm(
    { alias: initialValue },
    {
      alias: value =>
        !value.trim() || isValidUsername(value.trim())
          ? undefined
          : t('users.alias.errors.pattern', 'Alias contains characters a name can’t'),
    },
  )
  useFormCallbacks(form, {
    onSubmit: ({ alias }) => {
      const name = alias.trim()
      setUserAlias(user.id, !name || name === user.name ? undefined : name)
      onClose()
    },
  })
  return (
    <div>
      <NameForm noValidate={true} onSubmit={submit}>
        <NameField
          {...bindInput('alias')}
          ref={inputRef}
          allowErrors={true}
          onFocus={event => event.currentTarget.select()}
          onKeyDown={event => {
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              onClose()
            }
          }}
          inputProps={{
            'aria-label': t('users.alias.inputLabel', 'Local alias'),
            maxLength: USERNAME_MAXLENGTH,
            autoCapitalize: 'off',
            autoCorrect: 'off',
            spellCheck: false,
          }}
        />
        <IconButton
          type='submit'
          icon={<MaterialIcon icon='check' />}
          ariaLabel={t('users.alias.saveAction', 'Save alias')}
          title={t('users.alias.saveAction', 'Save alias')}
        />
        <IconButton
          icon={<MaterialIcon icon='close' />}
          onClick={onClose}
          ariaLabel={t('common.actions.cancel', 'Cancel')}
          title={t('common.actions.cancel', 'Cancel')}
        />
      </NameForm>
      <Hint>
        {t(
          'users.alias.inlineHint',
          'Only you see this alias. Clear it to show the original name.',
        )}
      </Hint>
    </div>
  )
}

/** A profile's displayed name and the local-only editor beside its copy-link button. */
export function ProfileName({ user }: { user: SbUser }) {
  const { t } = useTranslation()
  const self = useSelfUser()
  const alias = useUserAlias(user.id)
  const [editing, setEditing] = useState(false)
  const shownName = formatUserAlias(user.name, alias)
  const editLabel = t('users.alias.editAction', 'Edit alias')

  if (editing) {
    return (
      <NameEditor user={user} initialValue={alias ?? user.name} onClose={() => setEditing(false)} />
    )
  }

  return (
    <NameRow>
      <Name title={shownName}>{shownName}</Name>
      <CopyLinkButton
        tooltipPosition='top'
        startingText={t('users.profile.copyLink', 'Copy link to profile')}
      />
      {self && self.id !== user.id ? (
        <Tooltip text={editLabel} position='top' tabIndex={-1}>
          <IconButton
            icon={<MaterialIcon icon='edit' />}
            ariaLabel={editLabel}
            onClick={() => setEditing(true)}
          />
        </Tooltip>
      ) : null}
    </NameRow>
  )
}
