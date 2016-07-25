import React from 'react'
import classnames from 'classnames'
import uniqueId from '../dom/unique-id'
import styles from './text-field.css'

import FloatingLabel from './input-floating-label.jsx'
import InputError from './input-error.jsx'
import InputUnderline from './input-underline.jsx'
import Label from './input-label.jsx'

// A single-line Material text field, supporting with and without floating labels
class TextField extends React.Component {
  constructor(props) {
    super(props)
    this.id = uniqueId()
    this.state = {
      hasValue: !!(this.props.value || this.props.defaultValue),
      isFocused: false,
    }
  }

  componentWillReceiveProps(nextProps) {
    const hasNewDefault = nextProps.defaultValue !== this.props.defaultValue
    const hasValueProp = nextProps.hasOwnProperty('value')

    if (hasValueProp) {
      this.setState({ hasValue: !!nextProps.value })
    } else if (hasNewDefault) {
      this.setState({ hasValue: !!nextProps.defaultValue })
    }
  }

  render() {
    const {
      /*eslint-disable no-unused-vars*/
      floatingLabel,
      onEnterKeyDown,
      requiredMessage,
      validator,
      validationError,
      /* eslint-enable no-unused-vars */
      allowErrors,
      errorText,
      ...otherProps,
    } = this.props
    const classes = classnames(styles.textField, this.props.className, {
      [styles.disabled]: this.props.disabled,
    })

    const inputProps = {
      ref: 'input',
      id: this.id,
      onBlur: e => this._onInputBlur(e),
      onChange: e => this._onInputChange(e),
      onFocus: e => this._onInputFocus(e),
      onKeyDown: e => this._onKeyDown(e),
      type: this.props.type,
      className: styles.input,
    }

    return (
      <div className={classes}>
        {this.renderLabel()}
        <input {...otherProps} {...inputProps} />
        <InputUnderline focused={this.state.isFocused} error={!!errorText}
            disabled={this.props.disabled} />
        {allowErrors ? <InputError error={errorText} /> : null}
      </div>
    )
  }

  renderLabel() {
    if (!this.props.label) {
      return null
    } else if (this.props.floatingLabel) {
      return (
        <FloatingLabel htmlFor={this.id} text={this.props.label} hasValue={this.state.hasValue}
            focused={this.state.isFocused} disabled={this.props.disabled}
            error={!!this.props.errorText} />
      )
    } else {
      return <Label htmlFor={this.id} text={this.props.label} hasValue={this.state.hasValue} />
    }
  }

  blur() {
    this.refs.input.blur()
  }

  focus() {
    this.refs.input.focus()
  }

  clearValue() {
    this.setValue('')
  }

  getValue() {
    return this.refs.input.value
  }

  setValue(value) {
    this.refs.input.value = value
    this.setState({ hasValue: !!value })
  }

  _onInputBlur(e) {
    this.setState({ isFocused: false })
    if (this.props.onBlur) {
      this.props.onBlur(e)
    }
  }

  _onInputFocus(e) {
    this.setState({ isFocused: true })
    if (this.props.onFocus) {
      this.props.onFocus(e)
    }
  }

  _onInputChange(e) {
    this.setState({ hasValue: !!e.target.value })
    if (this.props.onChange) {
      this.props.onChange(e)
    }
  }

  _onKeyDown(e) {
    if (e.keyCode === 13 && this.props.onEnterKeyDown) {
      this.props.onEnterKeyDown(e)
    }
    if (this.props.onKeyDown) {
      this.props.onKeyDown(e)
    }
  }
}

TextField.propTypes = {
  allowErrors: React.PropTypes.bool,
  errorText: React.PropTypes.string,
  floatingLabel: React.PropTypes.bool,
  label: React.PropTypes.string,
  onBlur: React.PropTypes.func,
  onChange: React.PropTypes.func,
  onFocus: React.PropTypes.func,
  onKeyDown: React.PropTypes.func,
  onEnterKeyDown: React.PropTypes.func,
  type: React.PropTypes.string,
  className: React.PropTypes.oneOfType([
    React.PropTypes.string,
    React.PropTypes.array,
    React.PropTypes.object,
  ]),
}

TextField.defaultProps = {
  type: 'text',
  allowErrors: true,
  floatingLabel: false,
}

export default TextField
