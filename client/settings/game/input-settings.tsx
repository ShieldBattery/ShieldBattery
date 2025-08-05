import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useForm, useFormCallbacks } from '../../forms/form-hook'
import { MaterialIcon } from '../../icons/material/material-icon'
import { CheckBox } from '../../material/check-box'
import { Slider } from '../../material/slider'
import { Tooltip } from '../../material/tooltip'
import { useAppDispatch, useAppSelector } from '../../redux-hooks'
import { styledWithAttrs } from '../../styles/styled-with-attrs'
import { bodyMedium, LabelMedium } from '../../styles/typography'
import { mergeLocalSettings, mergeScrSettings } from '../action-creators'
import { FormContainer, SectionOverline } from '../settings-content'

const ExplanationText = styled.div`
  ${bodyMedium};

  margin-block: 8px 16px;

  color: var(--theme-on-surface-variant);
`

const SubSettings = styled.div`
  padding-top: 4px;
  padding-left: 32px;

  display: flex;
  flex-direction: column;
`

const ItemWithTooltip = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
`

const CursorSizeLabels = styled.div`
  width: 100%;
  margin-bottom: 12px;

  display: flex;
  flex-direction: row;
  justify-content: space-between;

  color: var(--theme-on-surface-variant);
`

const TooltipIcon = styledWithAttrs(MaterialIcon, { icon: 'info' })`
  color: var(--theme-on-surface-variant);
`

interface GameInputSettingsModel {
  keyboardScrollSpeed: number
  mouseScrollSpeed: number
  mouseSensitivityOn: boolean
  mouseSensitivity: number
  mouseScalingOn: boolean
  hardwareCursorOn: boolean
  mouseConfineOn: boolean
  legacyCursorSizing: boolean
  useCustomCursorSize: boolean
  customCursorSize: number
}

export function GameInputSettings() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const scrSettings = useAppSelector(s => s.settings.scr)
  const localSettings = useAppSelector(s => s.settings.local)

  const formModel: GameInputSettingsModel = {
    keyboardScrollSpeed: scrSettings.keyboardScrollSpeed,
    mouseScrollSpeed: scrSettings.mouseScrollSpeed,
    mouseSensitivityOn: scrSettings.mouseSensitivityOn,
    mouseSensitivity: scrSettings.mouseSensitivity,
    mouseScalingOn: scrSettings.mouseScalingOn,
    hardwareCursorOn: scrSettings.hardwareCursorOn,
    mouseConfineOn: scrSettings.mouseConfineOn,
    legacyCursorSizing: localSettings.legacyCursorSizing,
    useCustomCursorSize: localSettings.useCustomCursorSize,
    customCursorSize: localSettings.customCursorSize,
  }

  const { bindCustom, bindCheckable, getInputValue, submit, form } =
    useForm<GameInputSettingsModel>(formModel, {})

  useFormCallbacks(form, {
    onValidatedChange: model => {
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
      dispatch(
        mergeLocalSettings(
          {
            legacyCursorSizing: model.legacyCursorSizing,
            useCustomCursorSize: model.useCustomCursorSize,
            customCursorSize: model.customCursorSize,
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
        </div>
        <div>
          <CheckBox
            {...bindCheckable('mouseConfineOn')}
            label={t('settings.game.input.lockCursor', 'Lock cursor to window')}
            inputProps={{ tabIndex: 0 }}
          />
          <ItemWithTooltip>
            <CheckBox
              {...bindCheckable('hardwareCursorOn')}
              label={t('settings.game.input.hardwareCursor', 'Hardware cursor')}
              inputProps={{ tabIndex: 0 }}
            />
            <Tooltip
              position='right'
              text={t(
                'settings.game.input.hardwareCursorTooltip',
                'Recommended for best performance and input responsiveness',
              )}>
              <TooltipIcon />
            </Tooltip>
          </ItemWithTooltip>
          <SubSettings>
            <CheckBox
              {...bindCheckable('useCustomCursorSize')}
              label={t('settings.game.input.useCustomCursorSize', 'Use custom cursor size')}
              inputProps={{ tabIndex: 0 }}
              disabled={!getInputValue('hardwareCursorOn')}
            />
            <SubSettings>
              <Slider
                {...bindCustom('customCursorSize')}
                tabIndex={0}
                min={0.25}
                max={1.0}
                step={0.125}
                disabled={
                  !getInputValue('useCustomCursorSize') || !getInputValue('hardwareCursorOn')
                }
                showTicks={true}
                showBalloon={false}
              />
              <CursorSizeLabels>
                <LabelMedium>
                  {t('settings.game.input.customCursorSizeSmallest', 'Smallest')}
                </LabelMedium>
                <LabelMedium>
                  {t('settings.game.input.customCursorSizeLargest', 'Largest')}
                </LabelMedium>
              </CursorSizeLabels>
            </SubSettings>
            <ItemWithTooltip>
              <CheckBox
                {...bindCheckable('legacyCursorSizing')}
                label={t('settings.game.input.legacyCursorSizing', 'Use legacy cursor sizing')}
                inputProps={{ tabIndex: 0 }}
                disabled={!getInputValue('hardwareCursorOn')}
              />
              <Tooltip
                position='right'
                text={t(
                  'settings.game.input.legacyCursorSizingTooltip',
                  'Uses the original StarCraft: Remastered cursor sizes, which have inconsistent ' +
                    'scales at higher resolutions.',
                )}>
                <TooltipIcon />
              </Tooltip>
            </ItemWithTooltip>
          </SubSettings>
        </div>
        <div>
          <SectionOverline>
            {t('settings.game.input.legacySettingsHeader', 'Legacy settings')}
          </SectionOverline>
          <ExplanationText>
            {t(
              'settings.game.input.legacySettingsDescription',
              'These settings are available for compatibility with the StarCraft: Remastered ' +
                'settings, but are not recommended for use because they cause performance issues.',
            )}
          </ExplanationText>
          <CheckBox
            {...bindCheckable('mouseScalingOn')}
            label={t('settings.game.input.mouseScaling', 'Use mouse scaling')}
            inputProps={{ tabIndex: 0 }}
            disabled={getInputValue('hardwareCursorOn')}
          />
        </div>
      </FormContainer>
    </form>
  )
}
