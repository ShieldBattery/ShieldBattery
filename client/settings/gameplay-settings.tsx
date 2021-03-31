import PropTypes from 'prop-types'
import React from 'react'
import styled from 'styled-components'
import { LocalSettingsData, ScrSettingsData } from '../../common/local-settings'
import form, { FormChildProps, FormWrapper } from '../forms/form'
import SubmitOnEnter from '../forms/submit-on-enter'
import CheckBox from '../material/check-box'
import NumberTextField from '../material/number-text-field'
import Option from '../material/select/option'
import Select from '../material/select/select'
import { FormContainer } from './settings-content'

const ApmAlertCheckbox = styled(CheckBox)`
  margin-top: 32px;
`

interface GameplaySettingsModel {
  apmAlertOn: boolean
  apmAlertColorOn: boolean
  apmAlertSoundOn: boolean
  apmAlertValue: number
  apmDisplayOn: boolean
  colorCyclingOn: boolean
  gameTimerOn: boolean
  minimapPosition: boolean
  unitPortraits: number
}

function validateApmValue(val: number, model: GameplaySettingsModel) {
  if (!model.apmAlertOn) {
    return null
  }

  return val <= 0 || val > 999 ? 'Enter a value between 1 and 999' : null
}

class GameplayRemasteredForm extends React.Component<FormChildProps<GameplaySettingsModel>> {
  render() {
    const { bindCheckable, bindCustom, onSubmit } = this.props

    return (
      <form noValidate={true} onSubmit={onSubmit}>
        <SubmitOnEnter />
        <FormContainer>
          <div>
            <Select {...bindCustom('unitPortraits')} label='Portraits' tabIndex={0}>
              <Option value={2} text='Animated' />
              <Option value={1} text='Still' />
              <Option value={0} text='Disabled' />
            </Select>
            <Select {...bindCustom('minimapPosition')} label='Minimap position' tabIndex={0}>
              <Option value={true} text='Bottom-left corner' />
              <Option value={false} text='Standard' />
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
              disabled={!this.props.getInputValue('apmAlertOn')}
            />
            <CheckBox
              {...bindCheckable('apmAlertColorOn')}
              label='Color text'
              inputProps={{ tabIndex: 0 }}
              disabled={!this.props.getInputValue('apmAlertOn')}
            />
            <CheckBox
              {...bindCheckable('apmAlertSoundOn')}
              label='Play sound'
              inputProps={{ tabIndex: 0 }}
              disabled={!this.props.getInputValue('apmAlertOn')}
            />
          </div>
        </FormContainer>
      </form>
    )
  }
}

export const WrappedGameplayRemasteredForm = form<GameplaySettingsModel, Record<never, never>>({
  apmAlertValue: validateApmValue,
})(GameplayRemasteredForm)

export interface GameplaySettingsProps {
  localSettings: Partial<LocalSettingsData>
  scrSettings: Partial<ScrSettingsData>
  formRef: React.Ref<InstanceType<typeof WrappedGameplayRemasteredForm>>
  isRemastered?: boolean
  onChange: (values: GameplaySettingsModel) => void
  onSubmit: () => void
}

export default class GameplaySettings extends React.Component<GameplaySettingsProps> {
  static propTypes = {
    scrSettings: PropTypes.object.isRequired,
    formRef: PropTypes.object.isRequired,
    isRemastered: PropTypes.bool,
    onChange: PropTypes.func.isRequired,
    onSubmit: PropTypes.func.isRequired,
  }

  render() {
    const { scrSettings, formRef, isRemastered } = this.props

    if (!isRemastered) {
      // We don't have yet any gameplay-related settings for 1.16.1
      return null
    }

    // TODO(tec27): Get proper types for the settings reducer so this cast is unnecessary
    const formScrModel = { ...(scrSettings as any).toJS() }

    return (
      <WrappedGameplayRemasteredForm
        ref={formRef}
        model={formScrModel}
        onChange={this.onChange}
        onSubmit={this.onSubmit}
      />
    )
  }

  onChange = (form: FormWrapper<GameplaySettingsModel>) => {
    const values = form.getModel()
    this.props.onChange(values)
  }

  onSubmit = () => {
    this.props.onSubmit()
  }
}
