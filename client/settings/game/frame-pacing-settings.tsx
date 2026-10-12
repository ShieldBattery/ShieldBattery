import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { DisplayMode, getDisplayModeName } from '../../../common/settings/blizz-settings'
import { FramePacing } from '../../../common/settings/local-settings'
import { JsonLocalStorageValue } from '../../local-storage'
import { FilledButton, TextButton } from '../../material/button'
import { Callout } from '../../material/callout'
import { RadioCard, RadioCardGroup } from '../../material/radio-card'
import {
  bodyMedium,
  bodySmall,
  labelMedium,
  sofiaSansCondensed,
  titleSmall,
} from '../../styles/typography'
import { settingsRowSurface } from '../settings-rows'

/**
 * Input to screen, median, measured on a 120 Hz monitor in windowed fullscreen, the custom FPS
 * limit set to the refresh rate.
 */
const MEASURED_INPUT_TO_SCREEN_MS = {
  framePacing: 3.3,
  defaultFpsLimit: 3.2,
  customFpsLimit: 8.4,
  verticalSync: 24.7,
}

const Fieldset = styled.fieldset`
  ${settingsRowSurface};
  min-width: 0;
  margin: 0;
  padding: 16px;

  display: flex;
  flex-direction: column;
  gap: 12px;

  border: 0;
  border-radius: 6px;
`

const Legend = styled.legend`
  float: left;
  width: 100%;
  padding: 0;

  display: flex;
  flex-direction: column;
  gap: 2px;
`

const LegendTitle = styled.span`
  ${titleSmall};
  color: var(--theme-on-surface);
`

const LegendPrompt = styled.span`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

const Timeline = styled.span`
  position: relative;
  display: block;
  height: 44px;

  border-radius: 4px;
  background-color: var(--theme-surface);
  overflow: hidden;
`

const RefreshTick = styled.span`
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
`

const FrameMark = styled.span`
  position: absolute;
  top: 14px;
  height: 16px;
  border-radius: 1px;
`

/**
 * A small picture of when frames are presented (marks) against when the monitor refreshes (lines),
 * positioned as percentages of the strip's width.
 */
function PacingTimeline({
  refreshes,
  refreshColor,
  frames,
  frameColor,
  frameWidth,
}: {
  refreshes: ReadonlyArray<number>
  refreshColor: string
  frames: ReadonlyArray<number>
  frameColor: string
  frameWidth: number
}) {
  return (
    <Timeline>
      {refreshes.map(left => (
        <RefreshTick
          key={`refresh-${left}`}
          style={{ left: `${left}%`, backgroundColor: refreshColor }}
        />
      ))}
      {frames.map(left => (
        <FrameMark
          key={`frame-${left}`}
          style={{ left: `${left}%`, width: frameWidth, backgroundColor: frameColor }}
        />
      ))}
    </Timeline>
  )
}

const EVEN_REFRESHES = [20, 40, 60, 80]

const ExplainerArea = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const ExplainerToggle = styled(TextButton)`
  align-self: flex-start;
  margin-left: -12px;
`

const ExplainerPanel = styled.div`
  padding: 16px;

  display: flex;
  flex-direction: column;
  gap: 16px;

  border-radius: 4px;
  background-color: var(--theme-surface);
`

const ExplainerText = styled.p`
  ${bodyMedium};
  margin: 0;
  color: var(--theme-on-surface-variant);
`

const Chart = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
`

const ChartHeader = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 4px 12px;
`

const ChartTitle = styled.span`
  ${labelMedium};
  color: var(--theme-on-surface);
`

const ChartNote = styled.span`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
`

const ChartRow = styled.div<{ $best: boolean }>`
  display: grid;
  grid-template-columns: 180px minmax(0, 1fr) 64px;
  align-items: center;
  gap: 12px;

  color: ${props => (props.$best ? 'var(--theme-on-surface)' : 'var(--theme-on-surface-variant)')};
`

const ChartLabel = styled.span`
  ${bodySmall};
  font-size: 13px;
  line-height: 18px;
`

const ChartTrack = styled.span`
  display: block;
  height: 10px;
  border-radius: 2px;
  background-color: var(--theme-container-high);
`

const ChartBar = styled.span<{ $best: boolean }>`
  display: block;
  height: 100%;
  border-radius: 2px;
  background-color: ${props => (props.$best ? 'var(--theme-amber)' : 'var(--theme-outline)')};
`

const ChartValue = styled.span`
  ${sofiaSansCondensed};
  font-size: 18px;
  line-height: 20px;
  text-align: right;
`

function LatencyExplainer() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const panelId = useId()

  const rows = [
    {
      label: t('settings.game.video.framePacing.explainer.framePacing', 'Frame pacing'),
      ms: MEASURED_INPUT_TO_SCREEN_MS.framePacing,
      best: true,
    },
    {
      label: t(
        'settings.game.video.framePacing.explainer.defaultFpsLimit',
        'Default FPS limit (300)',
      ),
      ms: MEASURED_INPUT_TO_SCREEN_MS.defaultFpsLimit,
      best: false,
    },
    {
      label: t(
        'settings.game.video.framePacing.explainer.customFpsLimit',
        'Custom FPS limit (120)',
      ),
      ms: MEASURED_INPUT_TO_SCREEN_MS.customFpsLimit,
      best: false,
    },
    {
      label: t('settings.game.video.framePacing.explainer.verticalSync', 'Vertical sync'),
      ms: MEASURED_INPUT_TO_SCREEN_MS.verticalSync,
      best: false,
    },
  ]
  const longest = Math.max(...rows.map(row => row.ms))

  return (
    <ExplainerArea>
      <ExplainerToggle
        label={t(
          'settings.game.video.framePacing.explainer.toggle',
          'How frame pacing lowers delay',
        )}
        iconEnd={open ? 'expand_less' : 'expand_more'}
        ariaExpanded={open}
        ariaControls={panelId}
        onClick={() => setOpen(!open)}
      />
      {open ? (
        <ExplainerPanel id={panelId}>
          <ExplainerText>
            {t(
              'settings.game.video.framePacing.explainer.body',
              'Your monitor only shows a new image at each refresh. StarCraft normally waits ' +
                'between drawing a frame and showing it, so the frame you see is a few ' +
                'milliseconds old. Frame pacing draws each frame just before the refresh, using ' +
                'your newest input.',
            )}
          </ExplainerText>
          <Chart>
            <ChartHeader>
              <ChartTitle>
                {t('settings.game.video.framePacing.explainer.chartTitle', 'Input to screen')}
              </ChartTitle>
              <ChartNote>
                {t(
                  'settings.game.video.framePacing.explainer.chartNote',
                  'Median, 120 Hz monitor. Shorter is better.',
                )}
              </ChartNote>
            </ChartHeader>
            {rows.map(row => (
              <ChartRow key={row.label} $best={row.best}>
                <ChartLabel>{row.label}</ChartLabel>
                <ChartTrack>
                  <ChartBar $best={row.best} style={{ width: `${(row.ms / longest) * 100}%` }} />
                </ChartTrack>
                <ChartValue>
                  {t('settings.game.video.framePacing.explainer.milliseconds', {
                    defaultValue: '{{ms}} ms',
                    ms: row.ms.toFixed(1),
                  })}
                </ChartValue>
              </ChartRow>
            ))}
            <ChartNote>
              {t(
                'settings.game.video.framePacing.explainer.tearingNote',
                'The two FPS limit rows also tear.',
              )}
            </ChartNote>
          </Chart>
        </ExplainerPanel>
      ) : null}
    </ExplainerArea>
  )
}

/** Picks how the game paces its frames, with an explanation of the choice. */
export function FramePacingChooser({
  value,
  onChange,
  displayMode,
  onUseWindowedFullscreen,
}: {
  value: FramePacing
  onChange: (value: FramePacing) => void
  displayMode: DisplayMode
  onUseWindowedFullscreen: () => void
}) {
  const { t } = useTranslation()
  const titleId = useId()
  const promptId = useId()

  return (
    <Fieldset>
      <Legend>
        <LegendTitle id={titleId}>
          {t('settings.game.video.framePacing.title', 'Frame pacing')}
        </LegendTitle>
        <LegendPrompt id={promptId}>
          {t(
            'settings.game.video.framePacing.prompt',
            "G-SYNC or FreeSync turned on? Choose Variable refresh. Otherwise, or if you're not " +
              'sure, choose Match refresh.',
          )}
        </LegendPrompt>
      </Legend>

      <RadioCardGroup
        value={value}
        onChange={onChange}
        ariaLabelledBy={titleId}
        ariaDescribedBy={promptId}>
        <RadioCard
          value={FramePacing.Display}
          title={t('settings.game.video.framePacing.match.title', 'Match refresh')}
          subtitle={t('settings.game.video.framePacing.match.subtitle', 'Any monitor')}
          description={t(
            'settings.game.video.framePacing.match.description',
            'One fresh frame just before each refresh. Low delay, no tearing.',
          )}
          badge={t('settings.game.video.framePacing.recommended', 'Recommended')}
          media={
            <PacingTimeline
              refreshes={EVEN_REFRESHES}
              refreshColor='var(--theme-outline-variant)'
              frames={[15, 35, 55, 75]}
              frameColor='var(--theme-amber)'
              frameWidth={8}
            />
          }
          testName='frame-pacing-display'
        />
        <RadioCard
          value={FramePacing.VariableRefresh}
          title={t('settings.game.video.framePacing.variableRefresh.title', 'Variable refresh')}
          subtitle={t(
            'settings.game.video.framePacing.variableRefresh.subtitle',
            'G-SYNC / FreeSync',
          )}
          description={t(
            'settings.game.video.framePacing.variableRefresh.description',
            'The monitor refreshes when each frame is ready. Lowest delay, no tearing.',
          )}
          media={
            <PacingTimeline
              refreshes={[19, 36, 58, 77]}
              refreshColor='var(--color-amber80)'
              frames={[14, 31, 53, 72]}
              frameColor='var(--theme-amber)'
              frameWidth={8}
            />
          }
          testName='frame-pacing-variable-refresh'
        />
        <RadioCard
          value={FramePacing.Off}
          title={t('settings.game.video.framePacing.off.title', 'Off')}
          subtitle={t('settings.game.video.framePacing.off.subtitle', 'Original timing')}
          description={t(
            'settings.game.video.framePacing.off.description',
            'Draws as fast as your FPS limit allows. Tears unless vertical sync is on.',
          )}
          media={
            <PacingTimeline
              refreshes={EVEN_REFRESHES}
              refreshColor='var(--theme-outline-variant)'
              frames={[3, 10, 17, 24, 31, 38, 45, 52, 59, 66, 73, 80, 87, 94]}
              frameColor='var(--color-grey-blue70)'
              frameWidth={3}
            />
          }
          testName='frame-pacing-off'
        />
      </RadioCardGroup>

      <LatencyExplainer />

      {value !== FramePacing.Off && displayMode === DisplayMode.Windowed ? (
        <Callout
          variant='inline'
          icon='warning'
          actions={
            <TextButton
              label={t('settings.game.video.framePacing.useMode', {
                defaultValue: 'Use {{mode}}',
                mode: getDisplayModeName(DisplayMode.WindowedFullscreen, t),
              })}
              onClick={onUseWindowedFullscreen}
            />
          }>
          {t(
            'settings.game.video.framePacing.windowedHint',
            "Frame pacing can't help in a bordered window: Windows adds its own delay there.",
          )}
        </Callout>
      ) : null}
    </Fieldset>
  )
}

const nudgeDismissedStorage = new JsonLocalStorageValue<boolean>('framePacingNudgeDismissed')

/**
 * Suggests turning frame pacing on, for players who have it off, until they turn it on or say
 * not now.
 */
export function FramePacingNudge({
  vsyncOn,
  onTurnOn,
}: {
  vsyncOn: boolean
  onTurnOn: () => void
}) {
  const { t } = useTranslation()
  const [dismissed, setDismissed] = useState(() => nudgeDismissedStorage.getValue() ?? false)
  if (dismissed) {
    return null
  }

  return (
    <Callout
      icon='bolt'
      title={t(
        'settings.game.video.framePacing.nudge.title',
        'Lower your input delay with frame pacing',
      )}
      actions={
        <>
          <TextButton
            label={t('settings.game.video.framePacing.nudge.dismiss', 'Not now')}
            onClick={() => {
              nudgeDismissedStorage.setValue(true)
              setDismissed(true)
            }}
          />
          <FilledButton
            label={t('settings.game.video.framePacing.nudge.turnOn', 'Turn on')}
            onClick={onTurnOn}
          />
        </>
      }>
      {vsyncOn
        ? t(
            'settings.game.video.framePacing.nudge.vsyncBody',
            'Vertical sync adds a lot of input delay. Frame pacing stops tearing without it, ' +
              'and shows each frame with your newest input.',
          )
        : t(
            'settings.game.video.framePacing.nudge.body',
            'StarCraft normally waits between drawing a frame and showing it. Frame pacing ' +
              'draws each frame right before it’s shown, and stops tearing.',
          )}
    </Callout>
  )
}
