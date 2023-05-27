import React from 'react'
import { useForm } from '../../forms/form-hook'
import SubmitOnEnter from '../../forms/submit-on-enter'
import CheckBox from '../../material/check-box'
import Slider from '../../material/slider'
import { useAppDispatch, useAppSelector } from '../../redux-hooks'
import { useStableCallback } from '../../state-hooks'
import { mergeScrSettings } from '../action-creators'
import { FormContainer, Spacer } from '../settings-content'

interface GameInputSettingsModel {
  keyboardScrollSpeed: number
  mouseScrollSpeed: number
  mouseSensitivityOn: boolean
  mouseSensitivity: number
  mouseScalingOn: boolean
  hardwareCursorOn: boolean
  mouseConfineOn: boolean
}

export function GameInputSettings() {
  const dispatch = useAppDispatch()
  const scrSettings = useAppSelector(s => s.settings.scr)

  const onValidatedChange = useStableCallback((model: Readonly<GameInputSettingsModel>) => {
    dispatch(
      mergeScrSettings(
        {
          keyboardScrollSpeed: model.keyboardScrollSpeed,
          mouseScrollSpeed: model.mouseScrollSpeed,
          mouseSensitivityOn: model.mouseSensitivityOn,
          mouseSensitivity: model.mouseSensitivity,
          mouseScalingOn: model.mouseScalingOn,
          hardwareCursorOn: model.hardwareCursorOn,
          mouseConfineOn: model.mouseConfineOn,
        },
        {
          onSuccess: () => {},
          onError: () => {},
        },
      ),
    )
  })

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
          <Spacer />
          <Slider
            {...bindCustom('mouseScrollSpeed')}
            label='Mouse scroll speed'
            tabIndex={0}
            min={0}
            max={6}
            step={1}
          />
          <Spacer />
        </div>
        <div>
          <CheckBox
            {...bindCheckable('mouseSensitivityOn')}
            label='Custom mouse sensitivity'
            inputProps={{ tabIndex: 0 }}
          />
          <Slider
            {...bindCustom('mouseSensitivity')}
            label='Mouse sensitivity'
            tabIndex={0}
            min={0}
            max={100}
            step={5}
            disabled={!getInputValue('mouseSensitivityOn')}
            showTicks={false}
          />
          <Spacer />
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
