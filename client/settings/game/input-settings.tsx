import React from 'react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()
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
            label={t('settings.game.input.keyboardScrollSpeed', 'Keyboard scroll speed')}
            tabIndex={0}
            min={0}
            max={6}
            step={1}
          />
          <Slider
            {...bindCustom('mouseScrollSpeed')}
            label={t('settings.game.input.mouseScrollSpeed', 'Mouse scroll speed')}
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
            label={t('settings.game.input.customMouseSensitivity', 'Custom mouse sensitivity')}
            inputProps={{ tabIndex: 0 }}
          />
          <Slider
            {...bindCustom('mouseSensitivity')}
            label={t('settings.game.input.mouseSensitivity', 'Mouse sensitivity')}
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
            label={t('settings.game.input.mouseScaling', 'Use mouse scaling')}
            inputProps={{ tabIndex: 0 }}
          />
          <CheckBox
            {...bindCheckable('hardwareCursorOn')}
            label={t('settings.game.input.hardwareCursor', 'Hardware cursor')}
            inputProps={{ tabIndex: 0 }}
          />
          <CheckBox
            {...bindCheckable('mouseConfineOn')}
            label={t('settings.game.input.lockCursor', 'Lock cursor to window')}
            inputProps={{ tabIndex: 0 }}
          />
        </div>
      </FormContainer>
    </form>
  )
}
