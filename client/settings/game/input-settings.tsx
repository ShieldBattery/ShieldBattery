import React from 'react'
import styled from 'styled-components'
import { ScrSettings } from '../../../common/settings/local-settings'
import { useForm } from '../../forms/form-hook'
import SubmitOnEnter from '../../forms/submit-on-enter'
import CheckBox from '../../material/check-box'
import Slider from '../../material/slider'
import { useAppSelector } from '../../redux-hooks'
import { useStableCallback } from '../../state-hooks'
import { FormContainer } from '../settings-content'

const MouseSensitivitySlider = styled(Slider)`
  margin-bottom: 40px;
`

interface GameInputSettingsModel {
  keyboardScrollSpeed: number
  mouseScrollSpeed: number
  mouseSensitivityOn: boolean
  mouseSensitivity: number
  mouseScalingOn: boolean
  hardwareCursorOn: boolean
  mouseConfineOn: boolean
}

function GameInputSettingsForm({
  scrSettings,
  onValidatedChange,
}: {
  scrSettings: Omit<ScrSettings, 'version'>
  onValidatedChange: (model: Readonly<GameInputSettingsModel>) => void
}) {
  const { bindCheckable, bindCustom, getInputValue, onSubmit } = useForm(
    { ...scrSettings },
    {},
    { onValidatedChange },
  )

  return (
    <form noValidate={true} onSubmit={onSubmit}>
      <SubmitOnEnter />
      <FormContainer>
        <div>
          <Slider
            {...bindCustom('keyboardScrollSpeed')}
            label='Keyboard scroll speed'
            tabIndex={0}
            min={0}
            max={6}
            step={1}
          />
          <Slider
            {...bindCustom('mouseScrollSpeed')}
            label='Mouse scroll speed'
            tabIndex={0}
            min={0}
            max={6}
            step={1}
          />
        </div>
        <div>
          <CheckBox
            {...bindCheckable('mouseSensitivityOn')}
            label='Custom mouse sensitivity'
            inputProps={{ tabIndex: 0 }}
          />
          <MouseSensitivitySlider
            {...bindCustom('mouseSensitivity')}
            label='Mouse sensitivity'
            tabIndex={0}
            min={0}
            max={100}
            step={5}
            disabled={!getInputValue('mouseSensitivityOn')}
            showTicks={false}
          />
          <CheckBox
            {...bindCheckable('mouseScalingOn')}
            label='Use mouse scaling'
            inputProps={{ tabIndex: 0 }}
          />
          <CheckBox
            {...bindCheckable('hardwareCursorOn')}
            label='Hardware cursor'
            inputProps={{ tabIndex: 0 }}
          />
          <CheckBox
            {...bindCheckable('mouseConfineOn')}
            label='Lock cursor to window'
            inputProps={{ tabIndex: 0 }}
          />
        </div>
      </FormContainer>
    </form>
  )
}

export function GameInputSettings() {
  const scrSettings = useAppSelector(s => s.settings.scr)

  const onValidatedChange = useStableCallback((model: Readonly<GameInputSettingsModel>) => {
    console.log(model)
    // FIXME(2Pac): Save the settings (debounced?)
  })

  return <GameInputSettingsForm scrSettings={scrSettings} onValidatedChange={onValidatedChange} />
}
