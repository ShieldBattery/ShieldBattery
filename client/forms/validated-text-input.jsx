import React from 'react'
import ValidatedInput from './validated-input.jsx'
import TextField from '../material/text-field.jsx'

class ValidatedTextInput extends ValidatedInput {
  constructor() {
    super()
  }

  render() {
    return (
      <TextField {...this.props}
          ref="input"
          errorText={this.props.validationError}
          onChange={e => this._onChange(e)}/>
    )
  }

  _onChange(e) {
    if (this.props.onChange) {
      this.props.onChange(this)
    }
  }

  hasValue() {
    return !!this.getValue()
  }

  getValue() {
    return this.refs.input.getValue()
  }

  focus() {
    this.refs.input.focus()
  }
}

ValidatedTextInput.propTypes = Object.assign(ValidatedInput.propTypes, {
})

export default ValidatedTextInput
