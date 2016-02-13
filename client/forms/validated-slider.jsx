import React from 'react'
import ValidatedInput from './validated-input.jsx'
import Slider from '../material/slider.jsx'

class ValidatedSlider extends ValidatedInput {
  static propTypes = {
    ...ValidatedInput.propTypes,
  };

  render() {
    return (
      <Slider {...this.props} ref='input' />
    )
  }

  hasValue() {
    return true
  }

  getValue() {
    return this.refs.input.getValue()
  }

  focus() {
    this.refs.input.focus()
  }
}

export default ValidatedSlider
