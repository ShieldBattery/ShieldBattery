import React from 'react'
import PropTypes from 'prop-types'

import CheckBox from '../material/check-box.jsx'
import form from '../forms/form.jsx'
import Option from '../material/select/option.jsx'
import SubmitOnEnter from '../forms/submit-on-enter.jsx'
import Select from '../material/select/select.jsx'
import NumberTextField from '../material/number-text-field.jsx'
import { FormContainer } from './settings-content.jsx'

function validApmValue() {
  return (val, model) =>
    (model.apmAlertOn && !val) || val < 0 || val > 999 ? 'Enter a value between 0 and 999' : null
}

@form({ apmAlertValue: validApmValue() })
class GameplayRemasteredForm extends React.Component {
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
              <Option value={true} text='Left Corner' />
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
            <CheckBox
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

export default class GameplaySettings extends React.Component {
  static propTypes = {
    localSettings: PropTypes.object.isRequired,
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

    const formScrModel = { ...scrSettings.toJS() }

    return (
      <GameplayRemasteredForm
        ref={formRef}
        model={formScrModel}
        onChange={this.onChange}
        onSubmit={this.onSubmit}
      />
    )
  }

  onChange = () => {
    const values = this.props.formRef.current.getModel()
    this.props.onChange(values)
  }

  onSubmit = () => {
    this.props.onSubmit()
  }
}
