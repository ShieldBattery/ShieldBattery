import React from 'react'
import classnames from 'classnames'
import uniqueId from '../dom/unique-id'
import styles from './check-box.css'

class CheckBox extends React.Component {
  static propTypes = {
    name: React.PropTypes.string,
    checked: React.PropTypes.bool,
    label: React.PropTypes.string,
    value: React.PropTypes.string,
    onChange: React.PropTypes.func,
    disabled: React.PropTypes.bool,
    className: React.PropTypes.oneOfType([
      React.PropTypes.string,
      React.PropTypes.array,
      React.PropTypes.object,
    ])
  };

  id = uniqueId();
  state = {
    isKeyboardFocused: false,
  };
  mouseActive = false;
  clearMouseActive = null;

  render() {
    const {
      className,
      label,
      checked,
      value,
      onChange,
      disabled,
      inputProps,
    } = this.props
    const classes = classnames(styles.checkBox, className, {
      [styles.checked]: checked,
      [styles.disabled]: disabled,
      [styles.focused]: this.state.isKeyboardFocused,
    })

    const labelElem = label ? <label htmlFor={this.id}>{this.props.label}</label> : null
    const iconElem = <div className={styles.icon}></div>

    const internalInputProps = {
      type: 'checkbox',
      id: this.id,
      checked,
      value,
      disabled,
      onBlur: this.onBlur,
      onFocus: this.onFocus,
      onChange,
      onMouseDown: this.onMouseDown,
    }
    const inputElem = <input {...inputProps} {...internalInputProps} />

    return (<div className={classes}>
      {inputElem}
      <div className={styles.iconContainer}>
        {iconElem}
      </div>
      {labelElem}
    </div>)
  }

  onBlur = e => {
    if (this.state.isKeyboardFocused) {
      this.setState({ isKeyboardFocused: false })
    }
  };

  onFocus = e => {
    if (!this.mouseActive) {
      this.setState({ isKeyboardFocused: true })
    }
  };

  onMouseDown = e => {
    if (this.clearMouseActive) {
      clearTimeout(this.clearMouseActive)
    }
    this.clearMouseActive = setTimeout(() => {
      this.mouseActive = false
      this.clearMouseActive = null
    }, 100)
    this.mouseActive = true
  };
}


export default CheckBox
