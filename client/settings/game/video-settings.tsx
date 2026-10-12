import type { Display } from 'electron'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { getErrorStack } from '../../../common/errors'
import { TypedIpcRenderer } from '../../../common/ipc'
import {
  ALL_DISPLAY_MODES,
  DisplayMode,
  getDisplayModeName,
  SCR_GAMMA_MAX,
  SCR_GAMMA_MIN,
} from '../../../common/settings/blizz-settings'
import {
  ALL_GAME_WINDOW_PLACEMENTS,
  FramePacing,
  GAME_WINDOW_PRESET_GROUPS,
  GameWindowPlacement,
  GameWindowSize,
  getGameWindowPlacementLabel,
} from '../../../common/settings/local-settings'
import { useForm, useFormCallbacks } from '../../forms/form-hook'
import { MaterialIcon } from '../../icons/material/material-icon'
import logger from '../../logging/logger'
import { TextButton } from '../../material/button'
import { Divider } from '../../material/menu/divider'
import { OnOffSegmentedButtons } from '../../material/segmented-button'
import { SelectOption } from '../../material/select/option'
import { Select } from '../../material/select/select'
import { Slider } from '../../material/slider'
import { useAppDispatch, useAppSelector } from '../../redux-hooks'
import { bodyMedium } from '../../styles/typography'
import { mergeLocalSettings, mergeScrSettings } from '../action-creators'
import {
  SettingsRow,
  SettingsRowGroup,
  SettingsRowNote,
  SettingsSection,
  SettingsStackedRow,
} from '../settings-rows'
import { FramePacingChooser, FramePacingNudge } from './frame-pacing-settings'

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

const Sections = styled.div`
  display: flex;
  flex-direction: column;
  gap: 40px;
`

const FrameRateSection = styled(SettingsSection)`
  gap: 16px;
`

/** The slider fills its row, which already spaces it from the label above. */
const RowSlider = styled(Slider)`
  padding-block: 0;
`

const RowSelect = styled(Select)`
  width: 100%;
`

const UnusedNote = styled.span`
  ${bodyMedium};
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--theme-on-surface-variant);
`

interface GameVideoSettingsModel {
  displayMode: DisplayMode
  monitorId: number | null
  gamma: number
  sdGraphicsFilter: number
  framePacing: FramePacing
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
  windowPlacement: GameWindowPlacement
  windowSize: Readonly<GameWindowSize>
}

type BooleanSetting = {
  [K in keyof GameVideoSettingsModel]: GameVideoSettingsModel[K] extends boolean ? K : never
}[keyof GameVideoSettingsModel]

function isSameWindowSize(a: Readonly<GameWindowSize>, b: Readonly<GameWindowSize>): boolean {
  return a.width === b.width && a.height === b.height
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
    framePacing: localSettings.framePacing,
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
    windowPlacement: localSettings.gameWinPlacement,
    windowSize: localSettings.gameWinSetSize,
  }

  const { bindCustom, getInputValue, setInputValue, submit, form } =
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
            gameWinPlacement: model.windowPlacement,
            gameWinSetSize: model.windowSize,
            framePacing: model.framePacing,
          },
          {
            onSuccess: () => {},
            onError: () => {},
          },
        ),
      )
    },
  })

  const resetWindowPosition = () => {
    dispatch(
      mergeLocalSettings(
        {
          gameWinX: undefined,
          gameWinY: undefined,
          gameWinWidth: undefined,
          gameWinHeight: undefined,
        },
        {
          onSuccess: () => {},
          onError: () => {},
        },
      ),
    )
  }

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

  const displayMode = getInputValue('displayMode')
  const framePacing = getInputValue('framePacing')
  const pacingOn = framePacing !== FramePacing.Off
  const vsyncOn = getInputValue('vsyncOn') === 1
  const windowed = displayMode === DisplayMode.Windowed

  const onOffRow = (name: BooleanSetting, label: string) => (
    <SettingsRow label={label}>
      {labelId => (
        <OnOffSegmentedButtons
          value={getInputValue(name)}
          onChange={value => setInputValue(name, value)}
          ariaLabelledBy={labelId}
        />
      )}
    </SettingsRow>
  )

  return (
    <form noValidate={true} onSubmit={submit}>
      <Sections>
        <SettingsSection title={t('settings.game.video.sections.display', 'Display')}>
          <SettingsRowGroup>
            <SettingsRow label={t('settings.game.video.displayMode.title', 'Display mode')}>
              {labelId => (
                <RowSelect
                  {...bindCustom('displayMode')}
                  dense={true}
                  allowErrors={false}
                  ariaLabelledBy={labelId}
                  tabIndex={0}>
                  {ALL_DISPLAY_MODES.map((dm, i) => (
                    <SelectOption key={i} value={dm} text={getDisplayModeName(dm, t)} />
                  ))}
                </RowSelect>
              )}
            </SettingsRow>
            {windowed ? (
              <>
                <SettingsRow
                  label={t('settings.game.video.windowPlacement.title', 'Window placement')}>
                  {labelId => (
                    <RowSelect
                      {...bindCustom('windowPlacement')}
                      dense={true}
                      allowErrors={false}
                      ariaLabelledBy={labelId}
                      tabIndex={0}>
                      {ALL_GAME_WINDOW_PLACEMENTS.map(placement => (
                        <SelectOption
                          key={placement}
                          value={placement}
                          text={getGameWindowPlacementLabel(placement, t)}
                        />
                      ))}
                    </RowSelect>
                  )}
                </SettingsRow>
                {getInputValue('windowPlacement') === GameWindowPlacement.SetSize ? (
                  <SettingsRow label={t('settings.game.video.windowSize', 'Window size')}>
                    {labelId => (
                      <RowSelect
                        {...bindCustom('windowSize')}
                        dense={true}
                        allowErrors={false}
                        ariaLabelledBy={labelId}
                        compareValues={isSameWindowSize}
                        tabIndex={0}>
                        {GAME_WINDOW_PRESET_GROUPS.flatMap(({ aspectRatio, sizes }, i) => [
                          ...(i > 0 ? [<Divider key={`${aspectRatio}-divider`} />] : []),
                          ...sizes.map(size => (
                            <SelectOption
                              key={`${size.width}x${size.height}`}
                              value={size}
                              text={t('settings.game.video.windowSizeOption', {
                                defaultValue: '{{width}} × {{height}} ({{aspectRatio}})',
                                width: size.width,
                                height: size.height,
                                aspectRatio,
                              })}
                            />
                          )),
                        ])}
                      </RowSelect>
                    )}
                  </SettingsRow>
                ) : null}
                <SettingsRow label={t('settings.game.video.windowPosition', 'Window position')}>
                  <TextButton
                    label={t('settings.game.video.resetWindowPositionButton', 'Reset')}
                    disabled={localSettings.gameWinX === undefined}
                    onClick={resetWindowPosition}
                    testName='reset-game-window-position'
                  />
                </SettingsRow>
              </>
            ) : (
              <SettingsRow label={t('settings.game.video.monitor', 'Monitor')}>
                {labelId => (
                  <RowSelect
                    {...bindCustom('monitorId')}
                    dense={true}
                    allowErrors={false}
                    ariaLabelledBy={labelId}
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
                  </RowSelect>
                )}
              </SettingsRow>
            )}
            <SettingsStackedRow
              label={t('settings.game.video.brightness', 'Brightness')}
              readout={String(getInputValue('gamma'))}
              disabled={displayMode !== DisplayMode.Fullscreen}
              helperText={
                displayMode !== DisplayMode.Fullscreen
                  ? t(
                      'settings.game.video.brightnessFullscreenOnly',
                      'Only available in Fullscreen',
                    )
                  : undefined
              }>
              {labelId => (
                <RowSlider
                  {...bindCustom('gamma')}
                  min={GAMMA_SLIDER_MIN}
                  max={GAMMA_SLIDER_MAX}
                  step={GAMMA_SLIDER_STEP}
                  disabled={displayMode !== DisplayMode.Fullscreen}
                  ariaLabelledBy={labelId}
                />
              )}
            </SettingsStackedRow>
            {onOffRow(
              'pillarboxOn',
              t('settings.game.video.pillarbox', 'Pillarbox (4:3 aspect ratio)'),
            )}
          </SettingsRowGroup>
        </SettingsSection>

        <FrameRateSection
          title={t('settings.game.video.sections.frameRate', 'Frame rate and input delay')}>
          {pacingOn ? null : (
            <FramePacingNudge
              vsyncOn={vsyncOn}
              onTurnOn={() => setInputValue('framePacing', FramePacing.Display)}
            />
          )}
          <FramePacingChooser
            value={framePacing}
            onChange={value => setInputValue('framePacing', value)}
            displayMode={displayMode}
            onUseWindowedFullscreen={() =>
              setInputValue('displayMode', DisplayMode.WindowedFullscreen)
            }
          />
          <SettingsRowGroup>
            {pacingOn ? (
              <SettingsRow label={t('settings.game.video.fpsLimit', 'FPS limit')} disabled={true}>
                <UnusedNote>
                  <MaterialIcon icon='info' size={18} filled={false} />
                  {t('settings.game.video.fpsLimitUnused', 'Not used with frame pacing on')}
                </UnusedNote>
              </SettingsRow>
            ) : (
              <>
                {onOffRow(
                  'fpsLimitOn',
                  t('settings.game.video.customFpsLimit', 'Custom FPS limit'),
                )}
                {getInputValue('fpsLimitOn') ? (
                  <SettingsStackedRow
                    label={t('settings.game.video.fpsLimit', 'FPS limit')}
                    readout={String(getInputValue('fpsLimit'))}>
                    {labelId => (
                      <RowSlider
                        {...bindCustom('fpsLimit')}
                        min={100}
                        max={1000}
                        step={1}
                        ariaLabelledBy={labelId}
                      />
                    )}
                  </SettingsStackedRow>
                ) : null}
              </>
            )}
            <SettingsRow label={t('settings.game.video.verticalSync', 'Vertical sync')}>
              {labelId => (
                <OnOffSegmentedButtons
                  value={vsyncOn}
                  onChange={value => setInputValue('vsyncOn', value ? 1 : 0)}
                  ariaLabelledBy={labelId}
                />
              )}
            </SettingsRow>
            {vsyncOn && windowed ? (
              <SettingsRowNote>
                {t(
                  'settings.game.video.verticalSyncWindowedNote',
                  'Avoid vertical sync in a bordered window, where it adds a lot of input delay.',
                )}
              </SettingsRowNote>
            ) : null}
            {onOffRow('showFps', t('settings.game.video.showFps', 'Show FPS'))}
          </SettingsRowGroup>
        </FrameRateSection>

        <SettingsSection title={t('settings.game.video.sections.graphics', 'Graphics')}>
          <SettingsRowGroup>
            <SettingsStackedRow
              label={t('settings.game.video.sdGraphicsFilter', 'SD graphics filter')}>
              {labelId => (
                <RowSlider
                  {...bindCustom('sdGraphicsFilter')}
                  min={0}
                  max={3}
                  step={1}
                  ariaLabelledBy={labelId}
                />
              )}
            </SettingsStackedRow>
            {onOffRow('hdGraphicsOn', t('settings.game.video.hdGraphics', 'HD graphics'))}
            {onOffRow(
              'environmentEffectsOn',
              t('settings.game.video.environmentEffects', 'Environment effects'),
            )}
            {onOffRow(
              'realTimeLightingOn',
              t('settings.game.video.realTimeLighting', 'Real-time lighting'),
            )}
            {onOffRow(
              'smoothUnitTurningOn',
              t('settings.game.video.smoothUnitTurning', 'Smooth unit turning'),
            )}
            {onOffRow(
              'shadowStackingOn',
              t('settings.game.video.shadowStacking', 'Shadow stacking'),
            )}
          </SettingsRowGroup>
        </SettingsSection>
      </Sections>
    </form>
  )
}
