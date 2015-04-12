import React from 'react'
import ValidatedInput from './validated-input.jsx'
import { Checkbox } from 'material-ui'

class ValidatedCheckbox extends ValidatedInput {
  constructor() {
    super()
  }

  render() {
    // TODO(tec27): make this actually display error text
    return (
      <Checkbox {...this.props}
          ref="input"
          onCheck={e => this._onChange(e)}/>
    )
  }

  _onChange(e) {
    if (this.props.onChange) {
      this.props.onChange(this)
    }
  }

  hasValue() {
    return true
  }

  getValue() {
    return this.refs.input.isChecked()
  }

  focus() {
    this.refs.input.focus()
  }
}

ValidatedCheckbox.propTypes = Object.assign(ValidatedInput.propTypes, {
})

export default ValidatedCheckbox
