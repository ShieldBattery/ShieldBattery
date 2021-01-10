import React from 'react'
import PropTypes from 'prop-types'

import TextField from './text-field'

export default class NumberTextField extends React.Component {
  static propTypes = {
    value: PropTypes.number,
    onChange: PropTypes.func,
  }

  render() {
    return (
      <TextField
        {...this.props}
        type='number'
        value={this.props.value.toString()}
        onChange={this.onInputChange}
      />
    )
  }

  onInputChange = event => {
    if (this.props.onChange) {
      this.props.onChange(+event.target.value)
    }
  }
}
