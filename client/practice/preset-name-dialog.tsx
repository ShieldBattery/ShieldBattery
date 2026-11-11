import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { useAutoFocusRef } from '../material/auto-focus'
import { FilledButton, TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { TextField } from '../material/text-field'

export const MAX_PRESET_NAME_LENGTH = 40

const StyledDialog = styled(Dialog)`
  max-width: 480px;
`

export interface PresetNameDialogProps extends CommonDialogProps {
  title: string
  initialName?: string
  onSubmit: (name: string) => void
}

/** Names (or renames) a saved lineup or map pool. */
export function PresetNameDialog({
  title,
  initialName,
  onSubmit,
  onCancel,
  close,
}: PresetNameDialogProps) {
  const { t } = useTranslation()
  const inputRef = useAutoFocusRef<HTMLInputElement>()
  const [name, setName] = useState(initialName ?? '')
  const [showError, setShowError] = useState(false)

  const error = name.trim() ? undefined : t('practice.presetName.required', 'Enter a name')

  const submit = () => {
    setShowError(true)
    if (error) {
      return
    }
    onSubmit(name.trim())
    close()
  }

  const buttons = [
    <TextButton key='cancel' label={t('common.actions.cancel', 'Cancel')} onClick={onCancel} />,
    <FilledButton key='save' label={t('common.actions.save', 'Save')} onClick={submit} />,
  ]

  return (
    <StyledDialog showCloseButton={true} onCancel={onCancel} buttons={buttons} title={title}>
      <TextField
        ref={inputRef}
        label={t('practice.presetName.label', 'Name')}
        value={name}
        floatingLabel={true}
        allowErrors={true}
        errorText={showError ? error : undefined}
        inputProps={{ maxLength: MAX_PRESET_NAME_LENGTH, tabIndex: 0 }}
        onChange={event => setName(event.target.value)}
        onEnterKeyDown={submit}
      />
    </StyledDialog>
  )
}
