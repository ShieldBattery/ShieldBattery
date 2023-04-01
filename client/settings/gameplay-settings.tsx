import React, { useImperativeHandle, useMemo } from 'react'
import styled from 'styled-components'
import {
  ALL_CONSOLE_SKINS,
  ALL_INGAME_SKINS,
  ConsoleSkin,
  getConsoleSkinName,
  getIngameSkinName,
  IngameSkin,
} from '../../common/blizz-settings'
import { DEV_INDICATOR } from '../../common/flags'
import { useForm } from '../forms/form-hook'
import SubmitOnEnter from '../forms/submit-on-enter'
import CheckBox from '../material/check-box'
import { NumberTextField } from '../material/number-text-field'
import { SelectOption } from '../material/select/option'
import { Select } from '../material/select/select'
import { colorTextSecondary } from '../styles/colors'
import { overline } from '../styles/typography'
import { FormContainer } from './settings-content'
import { SettingsFormHandle } from './settings-form-ref'
import { LocalSettings, ScrSettings } from './settings-records'
import { useTranslation } from 'react-i18next'

const ApmAlertCheckbox = styled(CheckBox)`
  margin-top: 32px;
`

const SectionOverline = styled.div`
  ${overline};
  color: ${colorTextSecondary};
`

const BonusSkinsCheckBox = styled(CheckBox)`
  margin-bottom: 8px;
`

interface GameplaySettingsModel {
  apmAlertOn: boolean
  apmAlertColorOn: boolean
  apmAlertSoundOn: boolean
  apmAlertValue: number
  apmDisplayOn: boolean
  colorCyclingOn: boolean
  consoleSkin: ConsoleSkin
  gameTimerOn: boolean
  minimapPosition: boolean
  showBonusSkins: boolean
  selectedSkin: IngameSkin
  unitPortraits: number
  showTurnRate: boolean
  // Dev-only settings
  visualizeNetworkStalls?: boolean
}

function validateApmValue(val: number, model: GameplaySettingsModel) {
  if (!model.apmAlertOn) {
    return undefined
  }

  return val <= 0 || val > 999 ? 'Enter a value between 1 and 999' : undefined
}

const GameplayRemasteredForm = React.forwardRef<
  SettingsFormHandle,
  {
    model: GameplaySettingsModel
    onChange: (model: GameplaySettingsModel) => void
    onSubmit: (model: GameplaySettingsModel) => void
  }
>((props, ref) => {
  const { bindCheckable, bindCustom, onSubmit, getInputValue } = useForm(
    props.model,
    { apmAlertValue: validateApmValue },
    { onChange: props.onChange, onSubmit: props.onSubmit },
  )
  useImperativeHandle(ref, () => ({
    submit: onSubmit,
  }))
  const { t } = useTranslation()
  return (
    <form noValidate={true} onSubmit={onSubmit}>
      <SubmitOnEnter />
      <FormContainer>
        <div>
          <Select {...bindCustom('unitPortraits')} label={t('settings.gameplay.unitPortraitsLabel', 'Portraits')} tabIndex={0}>
            <SelectOption value={2} text={t('settings.gameplay.unitPortraitsAnimatedLabel', 'Animated')} />
            <SelectOption value={1} text={t('settings.gameplay.unitPortraitsStillLabel', 'Still')} />
            <SelectOption value={0} text={t('settings.gameplay.unitPortraitsDisabledLabel', 'Disabled')} />
          </Select>
          <Select {...bindCustom('minimapPosition')} label={t('settings.gameplay.minimapPositionLabel', 'Minimap position')} tabIndex={0}>
            <SelectOption value={true} text={t('settings.gameplay.minimapPositionBottomLeftLabel', 'Bottom-left corner')} />
            <SelectOption value={false} text={t('settings.gameplay.minimapPositionStandardLabel', 'Standard')} />
          </Select>
          <SectionOverline>{t('settings.skins.skinsLabel', 'Skins (must be purchased from Blizzard)')}</SectionOverline>
          <BonusSkinsCheckBox
            {...bindCheckable('showBonusSkins')}
            label={t('settings.skins.showBonusSkinsLabel', 'Show bonus skins')}
            inputProps={{ tabIndex: 0 }}
          />
          <Select
            {...bindCustom('selectedSkin')}
            label={t('settings.skins.selectedSkinLabel', 'Ingame skin')}
            tabIndex={0}
            disabled={!getInputValue('showBonusSkins')}>
            {ALL_INGAME_SKINS.map(skin => (
              <SelectOption key={skin || 'default'} value={skin} text={getIngameSkinName(skin)} />
            ))}
          </Select>
          <Select {...bindCustom('consoleSkin')} label={t('settings.skins.consoleSkinLabel', 'Console skin')} tabIndex={0}>
            {ALL_CONSOLE_SKINS.map(skin => (
              <SelectOption key={skin} value={skin} text={getConsoleSkinName(skin)} />
            ))}
          </Select>
        </div>
        <div>
          <CheckBox
            {...bindCheckable('gameTimerOn')}
            label={t('settings.gameplay.gameTimerLabel', 'Game timer')}
            inputProps={{ tabIndex: 0 }}
          />
          <CheckBox
            {...bindCheckable('colorCyclingOn')}
            label={t('settings.gameplay.enableColorCyclingLabel', 'Enable color cycling')}
            inputProps={{ tabIndex: 0 }}
          />
          <CheckBox
            {...bindCheckable('showTurnRate')}
            label={t('settings.gameplay.showLatencyLabel', 'Show latency')}
            inputProps={{ tabIndex: 0 }}
          />
          <CheckBox
            {...bindCheckable('apmDisplayOn')}
            label={t('settings.gameplay.apmDisplayLabel', 'APM display')}
            inputProps={{ tabIndex: 0 }}
          />
          <ApmAlertCheckbox
            {...bindCheckable('apmAlertOn')}
            label={t('settings.gameplay.apmAlertDescriptionLabel', 'Alert when APM falls below')}
            inputProps={{ tabIndex: 0 }}
          />
          <NumberTextField
            {...bindCustom('apmAlertValue')}
            floatingLabel={false}
            dense={true}
            label={t('settings.gameplay.apmAlertValueLabel', 'APM value')}
            inputProps={{ min: 0, max: 999 }}
            disabled={!getInputValue('apmAlertOn')}
          />
          <CheckBox
            {...bindCheckable('apmAlertColorOn')}
            label={t('settings.gameplay.apmAlertColorLabel', 'Color text')}
            inputProps={{ tabIndex: 0 }}
            disabled={!getInputValue('apmAlertOn')}
          />
          <CheckBox
            {...bindCheckable('apmAlertSoundOn')}
            label={t('settings.gameplay.apmAlertSoundLabel', 'Play sound')}
            inputProps={{ tabIndex: 0 }}
            disabled={!getInputValue('apmAlertOn')}
          />
        </div>
        {DEV_INDICATOR ? (
          <div>
            <SectionOverline>{t('settings.admin.devOnlySettingsLabel', 'Dev-only settings')}</SectionOverline>
            <CheckBox
              {...bindCheckable('visualizeNetworkStalls')}
              label={t('settings.admin.visualizeNetworkStallsDescription', 'Visualize network stalls')}
              inputProps={{ tabIndex: 0 }}
            />
          </div>
        ) : null}
      </FormContainer>
    </form>
  )
})

export interface GameplaySettingsProps {
  localSettings: LocalSettings
  scrSettings: ScrSettings
  formRef: React.Ref<SettingsFormHandle>
  onChange: (values: GameplaySettingsModel) => void
  onSubmit: (values: GameplaySettingsModel) => void
}

export default function GameplaySettings({
  localSettings,
  scrSettings,
  formRef,
  onChange,
  onSubmit,
}: GameplaySettingsProps) {
  const formModel = useMemo(
    // TODO(tec27): remove cast once Immutable infers types properly
    () =>
      ({
        ...scrSettings.toJS(),
        visualizeNetworkStalls: localSettings.visualizeNetworkStalls,
      } as GameplaySettingsModel),
    [scrSettings, localSettings],
  )

  return (
    <GameplayRemasteredForm
      ref={formRef}
      model={formModel}
      onChange={onChange}
      onSubmit={onSubmit}
    />
  )
}
