import React, { useImperativeHandle, useMemo } from 'react'
import styled from 'styled-components'
import { useForm } from '../forms/form-hook'
import SubmitOnEnter from '../forms/submit-on-enter'
import CheckBox from '../material/check-box'
import Slider from '../material/slider'
import { FormContainer } from './settings-content'
import { SettingsFormHandle } from './settings-form-ref'
import { ScrSettings } from './settings-records'
import { useTranslation } from 'react-i18next'

const MouseSensitivitySlider = styled(Slider)`
  margin-bottom: 40px;
`

interface InputSettingsModel {
  keyboardScrollSpeed: number
  mouseScrollSpeed: number
  mouseSensitivityOn: boolean
  mouseSensitivity: number
  mouseScalingOn: boolean
  hardwareCursorOn: boolean
  mouseConfineOn: boolean
}

const InputSettingsForm = React.forwardRef<
  SettingsFormHandle,
  {
    model: InputSettingsModel
    onChange: (model: InputSettingsModel) => void
    onSubmit: (model: InputSettingsModel) => void
  }
>((props, ref) => {
  const { bindCheckable, bindCustom, getInputValue, onSubmit } = useForm(
    props.model,
    {},
    { onChange: props.onChange, onSubmit: props.onSubmit },
  )

  useImperativeHandle(ref, () => ({
    submit: onSubmit,
  }))
  const { t } = useTranslation()
  return (
    <form noValidate={true} onSubmit={onSubmit}>
      <SubmitOnEnter />
      <FormContainer>
        <div>
          <Slider
            {...bindCustom('keyboardScrollSpeed')}
            label={t('settings.inputSettings.keyboardScrollSpeedLabel', 'Keyboard scroll speed')}
            tabIndex={0}
            min={0}
            max={6}
            step={1}
          />
          <Slider
            {...bindCustom('mouseScrollSpeed')}
            label={t('settings.inputSettings.mouseScrollSpeedLabel', 'Mouse scroll speed')}
            tabIndex={0}
            min={0}
            max={6}
            step={1}
          />
        </div>
        <div>
          <CheckBox
            {...bindCheckable('mouseSensitivityOn')}
            label={t('settings.inputSettings.customMouseSensitivityLabel', 'Custom mouse sensitivity')}
            inputProps={{ tabIndex: 0 }}
          />
          <MouseSensitivitySlider
            {...bindCustom('mouseSensitivity')}
            label={t('settings.inputSettings.mouseSensitivityLabel', 'Mouse sensitivity')}
            tabIndex={0}
            min={0}
            max={100}
            step={5}
            disabled={!getInputValue('mouseSensitivityOn')}
            showTicks={false}
          />
          <CheckBox
            {...bindCheckable('mouseScalingOn')}
            label={t('settings.inputSettings.useMouseScalingLabel', 'Use mouse scaling')}
            inputProps={{ tabIndex: 0 }}
          />
          <CheckBox
            {...bindCheckable('hardwareCursorOn')}
            label={t('settings.inputSettings.useHardwareCursorLabel', 'Hardware cursor')}
            inputProps={{ tabIndex: 0 }}
          />
          <CheckBox
            {...bindCheckable('mouseConfineOn')}
            label={t('settings.inputSettings.lockCursorToWindowLabel', 'Lock cursor to window')}
            inputProps={{ tabIndex: 0 }}
          />
        </div>
      </FormContainer>
    </form>
  )
})

export interface InputSettingsProps {
  scrSettings: ScrSettings
  formRef: React.Ref<SettingsFormHandle>
  onChange: (values: InputSettingsModel) => void
  onSubmit: (values: InputSettingsModel) => void
}

export default function InputSettings({
  scrSettings,
  formRef,
  onChange,
  onSubmit,
}: InputSettingsProps) {
  const formModel = useMemo(() => ({ ...scrSettings.toJS() } as InputSettingsModel), [scrSettings])

  return (
    <InputSettingsForm ref={formRef} model={formModel} onChange={onChange} onSubmit={onSubmit} />
  )
}
