import React, { PropTypes } from 'react'
import classnames from 'classnames'
import uniqueId from '../dom/unique-id'
import styles from './text-field.css'

import FloatingLabel from './input-floating-label.jsx'
import InputError from './input-error.jsx'
import InputUnderline from './input-underline.jsx'
import Label from './input-label.jsx'

// A single-line Material text field, supporting with and without floating labels
export default class TextField extends React.Component {
  static propTypes = {
    value: PropTypes.string,
    name: PropTypes.string,
    type: PropTypes.string,
    allowErrors: PropTypes.bool,
    errorText: PropTypes.string,
    floatingLabel: PropTypes.bool,
    label: PropTypes.string,
    onBlur: PropTypes.func,
    onChange: PropTypes.func,
    onFocus: PropTypes.func,
    onKeyDown: PropTypes.func,
    onEnterKeyDown: PropTypes.func,
    className: PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.array,
      PropTypes.object,
    ]),
    inputProps: PropTypes.object,
  };

  static defaultProps = {
    type: 'text',
    allowErrors: true,
    floatingLabel: false,
  };

  id = uniqueId();
  state = {
    isFocused: false,
  };
  input = null;
  setInput = elem => { this.input = elem };

  render() {
    const {
      allowErrors,
      errorText,
      value,
      name,
      type,
      inputProps,
    } = this.props
    const classes = classnames(styles.textField, this.props.className, {
      [styles.disabled]: this.props.disabled,
    })

    const internalInputProps = {
      ref: this.setInput,
      id: this.id,
      className: styles.input,
      value,
      type,
      name,
      onBlur: this.onInputBlur,
      onChange: this.onInputChange,
      onFocus: this.onInputFocus,
      onKeyDown: this.onKeyDown,
    }

    return (
      <div className={classes}>
        {this.renderLabel()}
        <input {...inputProps} {...internalInputProps} />
        <InputUnderline focused={this.state.isFocused} error={!!errorText}
            disabled={this.props.disabled} />
        {allowErrors ? <InputError error={errorText} /> : null}
      </div>
    )
  }

  renderLabel() {
    const {
      label,
      floatingLabel,
      value,
      disabled,
      errorText,
    } = this.props
    if (!label) {
      return null
    } else if (floatingLabel) {
      return (
        <FloatingLabel htmlFor={this.id} text={label} hasValue={!!value}
            focused={this.state.isFocused} disabled={disabled}
            error={!!errorText} />
      )
    } else {
      return <Label htmlFor={this.id} text={label} hasValue={!!value} />
    }
  }

  blur() {
    this.input.blur()
  }

  focus() {
    this.input.focus()
  }

  onInputBlur = e => {
    this.setState({ isFocused: false })
    if (this.props.onBlur) {
      this.props.onBlur(e)
    }
  };

  onInputFocus = e => {
    this.setState({ isFocused: true })
    if (this.props.onFocus) {
      this.props.onFocus(e)
    }
  };

  onInputChange = e => {
    if (this.props.onChange) {
      this.props.onChange(e)
    }
  };

  onKeyDown = e => {
    if (e.keyCode === 13 && this.props.onEnterKeyDown) {
      this.props.onEnterKeyDown(e)
    }
    if (this.props.onKeyDown) {
      this.props.onKeyDown(e)
    }
  };
}
