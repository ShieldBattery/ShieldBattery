import type { Display } from 'electron'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getErrorStack } from '../../../common/errors'
import { TypedIpcRenderer } from '../../../common/ipc'
import {
  ALL_DISPLAY_MODES,
  DisplayMode,
  getDisplayModeName,
  SCR_GAMMA_MAX,
  SCR_GAMMA_MIN,
} from '../../../common/settings/blizz-settings'
import { useForm, useFormCallbacks } from '../../forms/form-hook'
import logger from '../../logging/logger'
import { CheckBox } from '../../material/check-box'
import { SelectOption } from '../../material/select/option'
import { Select } from '../../material/select/select'
import { Slider } from '../../material/slider'
import { useAppDispatch, useAppSelector } from '../../redux-hooks'
import { mergeLocalSettings, mergeScrSettings } from '../action-creators'
import { FormContainer, SectionContainer } from '../settings-content'

const ipcRenderer = new TypedIpcRenderer()

const GAMMA_SLIDER_MIN = 0
const GAMMA_SLIDER_MAX = 100
// Steps of five map exactly to SC:R's integer gamma values, so user-selected values do not shift
// when they are saved and loaded again.
const GAMMA_SLIDER_STEP = 5

function gammaToSliderValue(gamma: number): number {
  const clamped = Math.max(SCR_GAMMA_MIN, Math.min(SCR_GAMMA_MAX, gamma))
  return Math.round(
    ((clamped - SCR_GAMMA_MIN) / (SCR_GAMMA_MAX - SCR_GAMMA_MIN)) * GAMMA_SLIDER_MAX,
  )
}

function sliderValueToGamma(value: number): number {
  const clamped = Math.max(GAMMA_SLIDER_MIN, Math.min(GAMMA_SLIDER_MAX, value))
  return Math.round(SCR_GAMMA_MIN + (clamped / GAMMA_SLIDER_MAX) * (SCR_GAMMA_MAX - SCR_GAMMA_MIN))
}

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
  monitorId: number | null
  gamma: number
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
  const localSettings = useAppSelector(s => s.settings.local)

  const [monitors, setMonitors] = useState<Display[]>([])

  const initialModel: GameVideoSettingsModel = {
    displayMode: scrSettings.displayMode,
    monitorId: localSettings.monitorId ?? null,
    gamma: gammaToSliderValue(scrSettings.gamma),
    sdGraphicsFilter: scrSettings.sdGraphicsFilter,
    fpsLimitOn: scrSettings.fpsLimitOn,
    fpsLimit: scrSettings.fpsLimit,
    vsyncOn: scrSettings.vsyncOn,
    hdGraphicsOn: scrSettings.hdGraphicsOn,
    environmentEffectsOn: scrSettings.environmentEffectsOn,
    realTimeLightingOn: scrSettings.realTimeLightingOn,
    smoothUnitTurningOn: scrSettings.smoothUnitTurningOn,
    shadowStackingOn: scrSettings.shadowStackingOn,
    pillarboxOn: scrSettings.pillarboxOn,
    showFps: scrSettings.showFps,
  }

  const { bindCustom, bindCheckable, getInputValue, submit, form } =
    useForm<GameVideoSettingsModel>(initialModel, {})

  useFormCallbacks(form, {
    onValidatedChange: model => {
      dispatch(
        mergeScrSettings(
          {
            displayMode: model.displayMode,
            gamma: sliderValueToGamma(model.gamma),
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

      dispatch(
        mergeLocalSettings(
          {
            monitorId: model.monitorId === null ? undefined : model.monitorId,
          },
          {
            onSuccess: () => {},
            onError: () => {},
          },
        ),
      )
    },
  })

  useEffect(() => {
    ipcRenderer
      .invoke('settingsGetMonitorInfo')
      ?.then(({ monitors }) => {
        setMonitors(monitors)
      })
      .catch(err => {
        logger.error('Error getting monitor info: ' + getErrorStack(err))
      })
  }, [])

  return (
    <form noValidate={true} onSubmit={submit}>
      <FormContainer>
        <SectionContainer>
          <Select
            {...bindCustom('displayMode')}
            label={t('settings.game.video.displayMode.title', 'Display mode')}
            tabIndex={0}>
            {ALL_DISPLAY_MODES.map((dm, i) => (
              <SelectOption key={i} value={dm} text={getDisplayModeName(dm, t)} />
            ))}
          </Select>
          {getInputValue('displayMode') !== DisplayMode.Windowed ? (
            <Select
              {...bindCustom('monitorId')}
              label={t('settings.game.video.monitor', 'Monitor')}
              tabIndex={0}>
              <SelectOption
                key={'primary'}
                value={null}
                text={t('settings.game.video.primaryMonitor', 'Default (primary monitor)')}
              />
              {monitors.map((m, i) => (
                <SelectOption
                  key={m.id}
                  value={m.id}
                  text={t('settings.game.video.monitorItem', {
                    defaultValue: 'Monitor {{index}} - {{label}}',
                    index: i,
                    label: m.label,
                  })}
                />
              ))}
            </Select>
          ) : null}
          <Slider
            {...bindCustom('gamma')}
            label={t('settings.game.video.brightness', 'Brightness')}
            tabIndex={0}
            min={GAMMA_SLIDER_MIN}
            max={GAMMA_SLIDER_MAX}
            step={GAMMA_SLIDER_STEP}
            disabled={getInputValue('displayMode') !== DisplayMode.Fullscreen}
            showTicks={false}
          />
        </SectionContainer>
        <SectionContainer>
          <Slider
            {...bindCustom('sdGraphicsFilter')}
            label={t('settings.game.video.sdGraphicsFilter', 'SD graphics filter')}
            tabIndex={0}
            min={0}
            max={3}
            step={1}
          />
        </SectionContainer>
        <SectionContainer>
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
        </SectionContainer>
        <SectionContainer>
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
        </SectionContainer>
      </FormContainer>
    </form>
  )
}
