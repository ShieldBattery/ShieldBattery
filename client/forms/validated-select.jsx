import React from 'react'
import ValidatedInput from './validated-input.jsx'
import Select from '../material/select/select.jsx'

class ValidatedSelect extends ValidatedInput {
  static propTypes = {
    ...ValidatedInput.propTypes,
  };

  render() {
    return (
      <Select {...this.props} ref='input' errorText={this.props.validationError}/>
    )
  }

  hasValue() {
    return this.refs.input.hasValue()
  }

  getValue() {
    return this.refs.input.getValue()
  }

  focus() {
    this.refs.input.focus()
  }
}

export default ValidatedSelect
