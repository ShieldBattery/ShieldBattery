import React from 'react'
import styled from 'styled-components'
import { DEV_INDICATOR } from '../../../common/flags'
import {
  ALL_CONSOLE_SKINS,
  ALL_INGAME_SKINS,
  ConsoleSkin,
  getConsoleSkinName,
  getIngameSkinName,
  IngameSkin,
} from '../../../common/settings/blizz-settings'
import {
  LocalSettings,
  ScrSettings,
  ShieldBatteryAppSettings,
} from '../../../common/settings/local-settings'
import { useForm } from '../../forms/form-hook'
import SubmitOnEnter from '../../forms/submit-on-enter'
import CheckBox from '../../material/check-box'
import { NumberTextField } from '../../material/number-text-field'
import { SelectOption } from '../../material/select/option'
import { Select } from '../../material/select/select'
import { useAppDispatch, useAppSelector } from '../../redux-hooks'
import { useStableCallback } from '../../state-hooks'
import { colorTextSecondary } from '../../styles/colors'
import { overline } from '../../styles/typography'
import { mergeLocalSettings, mergeScrSettings } from '../action-creators'
import { FormContainer } from '../settings-content'

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

function GameplaySettingsForm({
  localSettings,
  scrSettings,
  onValidatedChange,
}: {
  localSettings: Omit<LocalSettings, keyof ShieldBatteryAppSettings>
  scrSettings: Omit<ScrSettings, 'version'>
  onValidatedChange: (model: Readonly<GameplaySettingsModel>) => void
}) {
  const { bindCheckable, bindCustom, onSubmit, getInputValue } = useForm(
    { ...scrSettings, visualizeNetworkStalls: localSettings.visualizeNetworkStalls },
    { apmAlertValue: validateApmValue },
    { onValidatedChange },
  )

  return (
    <form noValidate={true} onSubmit={onSubmit}>
      <SubmitOnEnter />
      <FormContainer>
        <div>
          <Select {...bindCustom('unitPortraits')} label='Portraits' tabIndex={0}>
            <SelectOption value={2} text='Animated' />
            <SelectOption value={1} text='Still' />
            <SelectOption value={0} text='Disabled' />
          </Select>
          <Select {...bindCustom('minimapPosition')} label='Minimap position' tabIndex={0}>
            <SelectOption value={true} text='Bottom-left corner' />
            <SelectOption value={false} text='Standard' />
          </Select>
          <SectionOverline>Skins (must be purchased from Blizzard)</SectionOverline>
          <BonusSkinsCheckBox
            {...bindCheckable('showBonusSkins')}
            label='Show bonus skins'
            inputProps={{ tabIndex: 0 }}
          />
          <Select
            {...bindCustom('selectedSkin')}
            label='Ingame skin'
            tabIndex={0}
            disabled={!getInputValue('showBonusSkins')}>
            {ALL_INGAME_SKINS.map(skin => (
              <SelectOption key={skin || 'default'} value={skin} text={getIngameSkinName(skin)} />
            ))}
          </Select>
          <Select {...bindCustom('consoleSkin')} label='Console skin' tabIndex={0}>
            {ALL_CONSOLE_SKINS.map(skin => (
              <SelectOption key={skin} value={skin} text={getConsoleSkinName(skin)} />
            ))}
          </Select>
        </div>
        <div>
          <CheckBox
            {...bindCheckable('gameTimerOn')}
            label='Game timer'
            inputProps={{ tabIndex: 0 }}
          />
          <CheckBox
            {...bindCheckable('colorCyclingOn')}
            label='Enable color cycling'
            inputProps={{ tabIndex: 0 }}
          />
          <CheckBox
            {...bindCheckable('showTurnRate')}
            label='Show latency'
            inputProps={{ tabIndex: 0 }}
          />
          <CheckBox
            {...bindCheckable('apmDisplayOn')}
            label='APM display'
            inputProps={{ tabIndex: 0 }}
          />
          <ApmAlertCheckbox
            {...bindCheckable('apmAlertOn')}
            label='Alert when APM falls below'
            inputProps={{ tabIndex: 0 }}
          />
          <NumberTextField
            {...bindCustom('apmAlertValue')}
            floatingLabel={false}
            dense={true}
            label='APM value'
            inputProps={{ min: 0, max: 999 }}
            disabled={!getInputValue('apmAlertOn')}
          />
          <CheckBox
            {...bindCheckable('apmAlertColorOn')}
            label='Color text'
            inputProps={{ tabIndex: 0 }}
            disabled={!getInputValue('apmAlertOn')}
          />
          <CheckBox
            {...bindCheckable('apmAlertSoundOn')}
            label='Play sound'
            inputProps={{ tabIndex: 0 }}
            disabled={!getInputValue('apmAlertOn')}
          />
        </div>
        {DEV_INDICATOR ? (
          <div>
            <SectionOverline>Dev-only settings</SectionOverline>
            <CheckBox
              {...bindCheckable('visualizeNetworkStalls')}
              label='Visualize network stalls'
              inputProps={{ tabIndex: 0 }}
            />
          </div>
        ) : null}
      </FormContainer>
    </form>
  )
}

export function GameplaySettings() {
  const dispatch = useAppDispatch()
  const localSettings = useAppSelector(s => s.settings.local)
  const scrSettings = useAppSelector(s => s.settings.scr)

  const onValidatedChange = useStableCallback((model: Readonly<GameplaySettingsModel>) => {
    dispatch(
      mergeScrSettings(model, {
        onSuccess: () => {},
        onError: () => {},
      }),
    )

    if (model.visualizeNetworkStalls !== localSettings.visualizeNetworkStalls) {
      dispatch(
        mergeLocalSettings(model, {
          onSuccess: () => {},
          onError: () => {},
        }),
      )
    }
  })

  return (
    <GameplaySettingsForm
      localSettings={localSettings}
      scrSettings={scrSettings}
      onValidatedChange={onValidatedChange}
    />
  )
}
