import React from 'react'
import PropTypes from 'prop-types'

import CheckBox from '../material/check-box.jsx'
import form from '../forms/form.jsx'
import Option from '../material/select/option.jsx'
import SubmitOnEnter from '../forms/submit-on-enter.jsx'
import Select from '../material/select/select.jsx'

@form()
class GameplayRemasteredForm extends React.Component {
  render() {
    const { bindCheckable, bindCustom, onSubmit } = this.props

    return (
      <form noValidate={true} onSubmit={onSubmit}>
        <SubmitOnEnter />
        <CheckBox
          {...bindCheckable('gameTimerOn')}
          label='Game Timer'
          inputProps={{ tabIndex: 0 }}
        />
        <CheckBox
          {...bindCheckable('colorCyclingOn')}
          label='Enable Color Cycling'
          inputProps={{ tabIndex: 0 }}
        />
        <Select {...bindCustom('unitPortraits')} label='Portraits' tabIndex={0}>
          <Option value={2} text='Animated' />
          <Option value={1} text='Still' />
          <Option value={0} text='Disabled' />
        </Select>
        <Select {...bindCustom('minimapPosition')} label='Mini-Map Position' tabIndex={0}>
          <Option value={true} text='Left Corner' />
          <Option value={false} text='Standard' />
        </Select>
        <CheckBox
          {...bindCheckable('apmDisplayOn')}
          label='Display APM In Game'
          inputProps={{ tabIndex: 0 }}
        />
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
