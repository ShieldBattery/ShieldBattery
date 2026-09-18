import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import {
  GAME_DEFAULTS_PRESET_VALUES,
  getGameDefaultsMismatches,
  getGameDefaultsPresetLabel,
} from '../../../common/settings/game-defaults'
import { GameDefaultsPreset } from '../../../common/settings/local-settings'
import { CommonDialogProps } from '../../dialogs/common-dialog-props'
import { MaterialIcon } from '../../icons/material/material-icon'
import { buttonReset } from '../../material/button-reset'
import { Dialog } from '../../material/dialog'
import { elevationPlus1, elevationPlus3 } from '../../material/shadows'
import { useAppDispatch, useAppSelector } from '../../redux-hooks'
import { bodyLarge, bodyMedium, titleSmall } from '../../styles/typography'
import { mergeLocalSettings } from '../action-creators'

const StyledDialog = styled(Dialog)`
  width: 480px;
  max-width: 480px;
`

const Explanation = styled.div`
  ${bodyLarge};
  margin-bottom: 16px;

  color: var(--theme-on-surface-variant);
  text-wrap: pretty;
`

const Choices = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`

const Choice = styled.button`
  ${buttonReset};
  ${elevationPlus1};

  width: 100%;
  padding: 14px 12px 14px 20px;

  display: flex;
  align-items: center;
  gap: 12px;

  background-color: var(--theme-container-high);
  border-radius: 6px;
  text-align: left;
  transition:
    background-color 125ms linear,
    box-shadow 125ms linear;

  &:hover {
    ${elevationPlus3};
    background-color: var(--theme-container-highest);
  }
`

const ChoiceText = styled.div`
  flex-grow: 1;

  display: flex;
  flex-direction: column;
  gap: 2px;
`

const ChoiceTitle = styled.div`
  ${titleSmall};
`

const ChoiceDescription = styled.div`
  ${bodyMedium};
  font-size: 13px;
  line-height: 18px;

  color: var(--theme-on-surface-variant);
  text-wrap: pretty;
`

const ChoiceIcon = styled(MaterialIcon).attrs({ icon: 'chevron_right' })`
  flex-shrink: 0;

  color: var(--theme-on-surface-variant);
`

/**
 * Asks whether changing the game defaults preset should also re-apply it to the settings it
 * covers, or only decide the default for settings added later. Dismissing keeps the current
 * values, the same as the explicit "keep" choice.
 */
export function GameDefaultsApplyDialog({
  preset,
  justSwitched,
  onCancel,
  close,
}: CommonDialogProps & { preset: GameDefaultsPreset; justSwitched: boolean }) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const localSettings = useAppSelector(s => s.settings.local)

  const presetName = getGameDefaultsPresetLabel(preset, t)
  const mismatchCount = getGameDefaultsMismatches(localSettings, preset).length

  const onReset = () => {
    dispatch(
      mergeLocalSettings(
        { ...GAME_DEFAULTS_PRESET_VALUES[preset] },
        { onSuccess: close, onError: close },
      ),
    )
  }

  const title = justSwitched
    ? t('settings.game.defaults.apply.switchedTitle', {
        defaultValue: 'Switched to {{preset}}',
        preset: presetName,
      })
    : t('settings.game.defaults.apply.resetTitle', {
        defaultValue: 'Reset to {{preset}}?',
        preset: presetName,
      })

  const resetDescription =
    preset === GameDefaultsPreset.Legacy
      ? t(
          'settings.game.defaults.apply.resetToLegacyDescription',
          'Starting fog, cursor sizing, team colors and drag pan switch to the Battle.net ' +
            'behavior.',
        )
      : t(
          'settings.game.defaults.apply.resetToRecommendedDescription',
          'Starting fog, cursor sizing, team colors and drag pan switch to the ShieldBattery ' +
            'defaults.',
        )

  return (
    <StyledDialog
      title={title}
      showCloseButton={true}
      onCancel={onCancel}
      testName='game-defaults-apply-dialog'>
      <Explanation>
        {t('settings.game.defaults.apply.explanation', {
          defaultValue:
            'New features will use {{preset}} defaults from now on. What about the {{count}} settings this preset covers?',
          defaultValue_one:
            'New features will use {{preset}} defaults from now on. What about the {{count}} setting this preset covers?',
          count: mismatchCount,
          preset: presetName,
        })}
      </Explanation>

      <Choices>
        <Choice type='button' onClick={onReset} data-testid='game-defaults-reset-choice'>
          <ChoiceText>
            <ChoiceTitle>
              {t('settings.game.defaults.apply.resetChoice', {
                defaultValue: 'Reset them to {{preset}}',
                preset: presetName,
              })}
            </ChoiceTitle>
            <ChoiceDescription>{resetDescription}</ChoiceDescription>
          </ChoiceText>
          <ChoiceIcon />
        </Choice>

        <Choice type='button' onClick={close} data-testid='game-defaults-keep-choice'>
          <ChoiceText>
            <ChoiceTitle>
              {t('settings.game.defaults.apply.keepChoice', 'Keep my current settings')}
            </ChoiceTitle>
            <ChoiceDescription>
              {t('settings.game.defaults.apply.keepChoiceDescription', {
                defaultValue: 'Nothing changes today. Only new features follow {{preset}}.',
                preset: presetName,
              })}
            </ChoiceDescription>
          </ChoiceText>
          <ChoiceIcon />
        </Choice>
      </Choices>
    </StyledDialog>
  )
}
