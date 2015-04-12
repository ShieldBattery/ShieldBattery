import React from 'react'

class ValidatedFormInput extends React.Component {
  constructor() {
    super()
  }

  validate(form) {
    if (this.props.required) {
      if (!this.hasValue()) {
        return this.props.requiredMessage
      }
    }

    if (this.hasValue() && this.props.validator) {
      return this.props.validator(this.getValue(), form)
    }

    return null
  }

  // These should be overridden in all subclasses
  hasValue() {
    return false
  }

  getValue() {
    return undefined
  }

  focus() {
  }
}

ValidatedFormInput.propTypes = {
  name: React.PropTypes.string.isRequired,
  required: React.PropTypes.bool,
  requiredMessage: props => {
    return ((props.required && !props.requiredMessage) ?
        new Error('requiredMessage is required when required is true') : null)
  },
  validationError: React.PropTypes.string,
  validator: React.PropTypes.func,
}

export default ValidatedFormInput
