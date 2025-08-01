import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  ALL_DISPLAY_MODES,
  DisplayMode,
  getDisplayModeName,
} from '../../../common/settings/blizz-settings'
import { useForm, useFormCallbacks } from '../../forms/form-hook'
import { CheckBox } from '../../material/check-box'
import { SelectOption } from '../../material/select/option'
import { Select } from '../../material/select/select'
import { Slider } from '../../material/slider'
import { useAppDispatch, useAppSelector } from '../../redux-hooks'
import { mergeScrSettings } from '../action-creators'
import { FormContainer } from '../settings-content'

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
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const scrSettings = useAppSelector(s => s.settings.scr)

  const { bindCustom, bindCheckable, getInputValue, submit, form } =
    useForm<GameVideoSettingsModel>({ ...scrSettings }, {})

  useFormCallbacks(form, {
    onValidatedChange: model => {
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
    },
  })

  return (
    <form noValidate={true} onSubmit={submit}>
      <FormContainer>
        <div>
          <Select
            {...bindCustom('displayMode')}
            label={t('settings.game.video.displayMode.title', 'Display mode')}
            tabIndex={0}>
            {ALL_DISPLAY_MODES.map((dm, i) => (
              <SelectOption key={i} value={dm} text={getDisplayModeName(dm, t)} />
            ))}
          </Select>
          <Slider
            {...bindCustom('sdGraphicsFilter')}
            label={t('settings.game.video.sdGraphicsFilter', 'SD graphics filter')}
            tabIndex={0}
            min={0}
            max={3}
            step={1}
          />
        </div>
        <div>
          <CheckBox
            {...bindCheckable('fpsLimitOn')}
            label={t('settings.game.video.customFpsLimit', 'Custom FPS limit')}
            inputProps={{ tabIndex: 0 }}
          />
          <Slider
            {...bindCustom('fpsLimit')}
            label={t('settings.game.video.fpsLimit', 'FPS limit')}
            tabIndex={0}
            min={100}
            max={1000}
            step={1}
            disabled={!getInputValue('fpsLimitOn')}
            showTicks={false}
          />
        </div>
        <div>
          <VsyncCheckBox
            {...bindCustom('vsyncOn')}
            label={t('settings.game.video.enableVerticalSync', 'Enable vertical sync')}
            inputProps={{ tabIndex: 0 }}
          />
          <CheckBox
            {...bindCheckable('hdGraphicsOn')}
            label={t('settings.game.video.hdGraphics', 'HD graphics')}
            inputProps={{ tabIndex: 0 }}
          />
          <CheckBox
            {...bindCheckable('environmentEffectsOn')}
            label={t('settings.game.video.environmentEffects', 'Environment effects')}
            inputProps={{ tabIndex: 0 }}
          />
          <CheckBox
            {...bindCheckable('realTimeLightingOn')}
            label={t('settings.game.video.realTimeLighting', 'Real-time lighting')}
            inputProps={{ tabIndex: 0 }}
          />
          <CheckBox
            {...bindCheckable('smoothUnitTurningOn')}
            label={t('settings.game.video.smoothUnitTurning', 'Smooth unit turning')}
            inputProps={{ tabIndex: 0 }}
          />
          <CheckBox
            {...bindCheckable('shadowStackingOn')}
            label={t('settings.game.video.shadowStacking', 'Shadow stacking')}
            inputProps={{ tabIndex: 0 }}
          />
          <CheckBox
            {...bindCheckable('pillarboxOn')}
            label={t('settings.game.video.pillarbox', 'Pillarbox (4:3 aspect ratio)')}
            inputProps={{ tabIndex: 0 }}
          />
          <CheckBox
            {...bindCheckable('showFps')}
            label={t('settings.game.video.showFps', 'Show FPS')}
            inputProps={{ tabIndex: 0 }}
          />
        </div>
      </FormContainer>
    </form>
  )
}
