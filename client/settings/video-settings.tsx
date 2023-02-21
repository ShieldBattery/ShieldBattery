import React, { useImperativeHandle, useMemo } from 'react'
import styled from 'styled-components'
import {
  ALL_DISPLAY_MODES,
  DisplayMode,
  getDisplayModeName,
} from '../../common/settings/blizz-settings'
import { useForm } from '../forms/form-hook'
import SubmitOnEnter from '../forms/submit-on-enter'
import CheckBox from '../material/check-box'
import { SelectOption } from '../material/select/option'
import { Select } from '../material/select/select'
import Slider from '../material/slider'
import { FormContainer } from './settings-content'
import { SettingsFormHandle } from './settings-form-ref'
import { ScrSettings } from './settings-records'

const Spacer = styled.div`
  width: 100%;
  height: 32px;
`

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

interface VideoSettingsModel {
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

const VideoSettingsForm = React.forwardRef<
  SettingsFormHandle,
  {
    model: VideoSettingsModel
    onChange: (model: VideoSettingsModel) => void
    onSubmit: (model: VideoSettingsModel) => void
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
})

export interface VideoSettingsProps {
  scrSettings: ScrSettings
  formRef: React.Ref<SettingsFormHandle>
  onChange: (values: VideoSettingsModel) => void
  onSubmit: (values: VideoSettingsModel) => void
}

export default function VideoSettings({
  scrSettings,
  formRef,
  onChange,
  onSubmit,
}: VideoSettingsProps) {
  const formModel = useMemo(() => ({ ...scrSettings.toJS() } as VideoSettingsModel), [scrSettings])

  return (
    <VideoSettingsForm ref={formRef} model={formModel} onChange={onChange} onSubmit={onSubmit} />
  )
}
