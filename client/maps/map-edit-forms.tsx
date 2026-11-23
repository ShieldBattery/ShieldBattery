import { useTranslation } from 'react-i18next'
import { useForm, useFormCallbacks } from '../forms/form-hook'
import { SubmitOnEnter } from '../forms/submit-on-enter'
import { required } from '../forms/validators'
import { MaterialIcon } from '../icons/material/material-icon'
import { useKeyListener } from '../keyboard/key-listener'
import { useAutoFocusRef } from '../material/auto-focus'
import { IconButton } from '../material/button'
import { TextField } from '../material/text-field'

const ESCAPE = 'Escape'

interface NameFormProps {
  initialName: string
  onSubmit: (model: { name: string }) => void
  onCancel: () => void
}

export function NameForm({ initialName, onSubmit, onCancel }: NameFormProps) {
  const { t } = useTranslation()
  const autoFocusRef = useAutoFocusRef<HTMLInputElement>()
  const { bindInput, submit, form } = useForm<{ name: string }>(
    { name: initialName },
    {
      name: required(t('maps.details.mapNameRequired', 'Enter a map name')),
    },
  )

  useFormCallbacks(form, {
    onSubmit,
  })

  const trailingIcons = [
    <IconButton
      icon={<MaterialIcon icon='check' />}
      title={t('common.actions.save', 'Save')}
      onClick={submit}
      key='save'
    />,
    <IconButton
      icon={<MaterialIcon icon='close' />}
      title={t('common.actions.cancel', 'Cancel')}
      onClick={onCancel}
      key='cancel'
    />,
  ]

  useKeyListener({
    onKeyDown: event => {
      if (event.code === ESCAPE) {
        onCancel()
        return true
      }

      return false
    },
  })

  return (
    <form noValidate={true} onSubmit={submit}>
      <SubmitOnEnter />
      <TextField
        {...bindInput('name')}
        ref={autoFocusRef}
        label={t('maps.details.mapName', 'Map name')}
        trailingIcons={trailingIcons}
      />
    </form>
  )
}

interface DescriptionFormProps {
  initialDescription: string
  onSubmit: (model: { description: string }) => void
  onCancel: () => void
}

export function DescriptionForm({ initialDescription, onSubmit, onCancel }: DescriptionFormProps) {
  const { t } = useTranslation()
  const autoFocusRef = useAutoFocusRef<HTMLInputElement>()
  const { bindInput, submit, form } = useForm<{ description: string }>(
    { description: initialDescription },
    {
      description: required(t('maps.details.mapDescriptionRequired', 'Enter a map description')),
    },
  )

  const trailingIcons = [
    <IconButton
      icon={<MaterialIcon icon='check' />}
      title={t('common.actions.save', 'Save')}
      onClick={submit}
      key='save'
    />,
    <IconButton
      icon={<MaterialIcon icon='close' />}
      title={t('common.actions.cancel', 'Cancel')}
      onClick={onCancel}
      key='cancel'
    />,
  ]

  useKeyListener({
    onKeyDown: event => {
      if (event.code === ESCAPE) {
        onCancel()
        return true
      }

      return false
    },
  })

  useFormCallbacks(form, {
    onSubmit,
  })

  return (
    <form noValidate={true} onSubmit={submit}>
      <TextField
        {...bindInput('description')}
        ref={autoFocusRef}
        label={t('maps.details.mapDescription', 'Map description')}
        multiline={true}
        rows={5}
        maxRows={5}
        trailingIcons={trailingIcons}
      />
    </form>
  )
}
