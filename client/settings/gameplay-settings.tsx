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
import { useForm } from '../forms/form-hook'
import SubmitOnEnter from '../forms/submit-on-enter'
import CheckBox from '../material/check-box'
import NumberTextField from '../material/number-text-field'
import { SelectOption } from '../material/select/option'
import { Select } from '../material/select/select'
import { colorTextSecondary } from '../styles/colors'
import { overline } from '../styles/typography'
import { FormContainer } from './settings-content'
import { SettingsFormHandle } from './settings-form-ref'
import { ScrSettings } from './settings-records'

const ApmAlertCheckbox = styled(CheckBox)`
  margin-top: 32px;
`

const SkinOverline = styled.div`
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
          <SkinOverline>Skins (must be purchased from Blizzard)</SkinOverline>
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
            label='Show turn rate'
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
      </FormContainer>
    </form>
  )
})

export interface GameplaySettingsProps {
  scrSettings: ScrSettings
  formRef: React.Ref<SettingsFormHandle>
  onChange: (values: GameplaySettingsModel) => void
  onSubmit: (values: GameplaySettingsModel) => void
}

export default function GameplaySettings({
  scrSettings,
  formRef,
  onChange,
  onSubmit,
}: GameplaySettingsProps) {
  const formModel = useMemo(
    // TODO(tec27): remove cast once Immutable infers types properly
    () => ({ ...scrSettings.toJS() } as GameplaySettingsModel),
    [scrSettings],
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
