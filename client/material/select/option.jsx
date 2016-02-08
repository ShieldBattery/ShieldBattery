import React, { PropTypes } from 'react'
import styles from './select.css'

class Option extends React.Component {
  static propTypes = {
    text: PropTypes.string.isRequired,
    value: PropTypes.any.isRequired,
    active: PropTypes.bool,
    onOptionSelected: PropTypes.func,
  };

  constructor(props) {
    super(props)
    this._clickHandler = ::this.onClick
  }

  render() {
    const className = styles.option + (this.props.active ? ' ' + styles.active : '')
    return (
      <div className={className} onClick={this._clickHandler}>
        <span className={styles.optionText}>
          { this.props.text }
        </span>
      </div>
    )
  }

  onClick() {
    if (this.props.onOptionSelected) {
      this.props.onOptionSelected(this.props.value)
    }
  }
}

export default Option
