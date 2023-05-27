import React from 'react'
import {
  ALL_DISPLAY_MODES,
  DisplayMode,
  getDisplayModeName,
} from '../../../common/settings/blizz-settings'
import { useForm } from '../../forms/form-hook'
import SubmitOnEnter from '../../forms/submit-on-enter'
import CheckBox from '../../material/check-box'
import { SelectOption } from '../../material/select/option'
import { Select } from '../../material/select/select'
import Slider from '../../material/slider'
import { useAppDispatch, useAppSelector } from '../../redux-hooks'
import { useStableCallback } from '../../state-hooks'
import { mergeScrSettings } from '../action-creators'
import { FormContainer, Spacer } from '../settings-content'

// NOTE(tec27): Vsync is weird and is a number in the settings, but actually a boolean value. This
// component just acts as a custom one and does the conversion
function VsyncCheckBox(props: {
  name: string
  value: number | null
  errorText?: string
  label: string
  inputProps: any
  onChange: (newValue: number) => void
}) {
  return (
    <CheckBox
      name={props.name}
      checked={!!props.value}
      errorText={props.errorText}
      label={props.label}
      inputProps={props.inputProps}
      onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
        const { checked } = event.target
        props.onChange(checked ? 1 : 0)
      }}
    />
  )
}

interface GameVideoSettingsModel {
  displayMode: DisplayMode
  sdGraphicsFilter: number
  fpsLimitOn: boolean
  fpsLimit: number
  vsyncOn: number
  hdGraphicsOn: boolean
  environmentEffectsOn: boolean
  realTimeLightingOn: boolean
  smoothUnitTurningOn: boolean
  shadowStackingOn: boolean
  pillarboxOn: boolean
  showFps: boolean
}

export function GameVideoSettings() {
  const dispatch = useAppDispatch()
  const scrSettings = useAppSelector(s => s.settings.scr)

  const onValidatedChange = useStableCallback((model: Readonly<GameVideoSettingsModel>) => {
    dispatch(
      mergeScrSettings(
        {
          displayMode: model.displayMode,
          sdGraphicsFilter: model.sdGraphicsFilter,
          fpsLimitOn: model.fpsLimitOn,
          fpsLimit: model.fpsLimit,
          vsyncOn: model.vsyncOn,
          hdGraphicsOn: model.hdGraphicsOn,
          environmentEffectsOn: model.environmentEffectsOn,
          realTimeLightingOn: model.realTimeLightingOn,
          smoothUnitTurningOn: model.smoothUnitTurningOn,
          shadowStackingOn: model.shadowStackingOn,
          pillarboxOn: model.pillarboxOn,
          showFps: model.showFps,
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
          <Select {...bindCustom('displayMode')} label='Display mode' tabIndex={0}>
            {ALL_DISPLAY_MODES.map((dm, i) => (
              <SelectOption key={i} value={dm} text={getDisplayModeName(dm)} />
            ))}
          </Select>
          <Slider
            {...bindCustom('sdGraphicsFilter')}
            label='SD graphics filter'
            tabIndex={0}
            min={0}
            max={3}
            step={1}
          />
          <Spacer />
          <CheckBox
            {...bindCheckable('fpsLimitOn')}
            label='Enable FPS limit'
            inputProps={{ tabIndex: 0 }}
          />
          <Slider
            {...bindCustom('fpsLimit')}
            label='FPS limit'
            tabIndex={0}
            min={100}
            max={300}
            step={1}
            disabled={!getInputValue('fpsLimitOn')}
            showTicks={false}
          />
          <Spacer />
        </div>
        <div>
          <VsyncCheckBox
            {...bindCustom('vsyncOn')}
            label='Enable vertical sync'
            inputProps={{ tabIndex: 0 }}
          />
          <CheckBox
            {...bindCheckable('hdGraphicsOn')}
            label='HD graphics'
            inputProps={{ tabIndex: 0 }}
          />
          <CheckBox
            {...bindCheckable('environmentEffectsOn')}
            label='Environment effects'
            inputProps={{ tabIndex: 0 }}
          />
          <CheckBox
            {...bindCheckable('realTimeLightingOn')}
            label='Real-time lighting'
            inputProps={{ tabIndex: 0 }}
          />
          <CheckBox
            {...bindCheckable('smoothUnitTurningOn')}
            label='Smooth unit turning'
            inputProps={{ tabIndex: 0 }}
          />
          <CheckBox
            {...bindCheckable('shadowStackingOn')}
            label='Shadow stacking'
            inputProps={{ tabIndex: 0 }}
          />
          <CheckBox
            {...bindCheckable('pillarboxOn')}
            label='Pillarbox (4:3 aspect ratio)'
            inputProps={{ tabIndex: 0 }}
          />
          <CheckBox {...bindCheckable('showFps')} label='Show FPS' inputProps={{ tabIndex: 0 }} />
        </div>
      </FormContainer>
    </form>
  )
}
