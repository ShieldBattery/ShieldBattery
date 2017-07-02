import React from 'react'
import PropTypes from 'prop-types'
import MenuItem from '../menu/item.jsx'

class Option extends React.Component {
  static propTypes = {
    text: PropTypes.string.isRequired,
    value: PropTypes.any.isRequired,
    active: PropTypes.bool,
    onOptionSelected: PropTypes.func,
  }

  constructor(props) {
    super(props)
    this._clickHandler = ::this.onClick
  }

  render() {
    const { text, active } = this.props
    return <MenuItem onClick={this._clickHandler} text={text} active={active} />
  }

  onClick() {
    if (this.props.onOptionSelected) {
      this.props.onOptionSelected(this.props.value)
    }
  }
}

export default Option
