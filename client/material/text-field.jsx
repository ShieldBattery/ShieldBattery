import React from 'react'
import classnames from 'classnames'
import uniqueId from '../dom/unique-id'

// A single-line Material text field, supporting with and without floating labels
class TextField extends React.Component {
  constructor(props) {
    super(props)
    this.id = uniqueId()
    this.state = {
      hasValue: !!(this.props.value || this.props.defaultValue)
    }
  }

  componentWillReceiveProps(nextProps) {
    let hasNewDefault = nextProps.defaultValue !== this.props.defaultValue
    let hasValueProp = nextProps.hasOwnProperty('value')

    if (hasValueProp) {
      this.setState({ hasValue: !!nextProps.value })
    } else if (hasNewDefault) {
      this.setState({ hasValue: !!nextProps.defaultValue })
    }
  }

  render() {
    let classes = classnames('text-field', {
      error: !!this.props.errorText,
      'floating-label': this.props.floatingLabel,
      'has-value': this.state.hasValue,
      disabled: this.props.disabled,
      focused: this.state.isFocused,
    })

    let hintText = this.props.hintText ?
        <label htmlFor={this.id}>{this.props.hintText}</label> : null

    let inputProps = {
      ref: 'input',
      id: this.id,
      onBlur: e => this._onInputBlur(e),
      onChange: e => this._onInputChange(e),
      onFocus: e => this._onInputFocus(e),
      onKeyDown: e => this._onKeyDown(e),
      type: this.props.type
    }

    return (
      <div className={classes}>
        {hintText}
        <input {...this.props} {...inputProps} />
        <hr className="text-field-underline" />
        <hr className="text-field-focus-underline" />
        <div className="text-field-error">{this.props.errorText}</div>
      </div>
    )
  }

  blur() {
    this._getInputNode().blur()
  }

  focus() {
    this._getInputNode().focus()
  }

  clearValue() {
    this.setValue('')
  }

  getValue() {
    return this._getInputNode().value
  }

  setValue(value) {
    this._getInputNode().value = value
    this.setState({ hasValue: !!value })
  }

  _getInputNode() {
    return this.refs.input.getDOMNode()
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
    if (e.keyCode == 13 && this.props.onEnterKeyDown) {
      this.props.onEnterKeyDown(e)
    }
    if (this.props.onKeyDown) {
      this.props.onKeyDown(e)
    }
  }
}

TextField.propTypes = {
  errorText: React.PropTypes.string,
  floatingLabel: React.PropTypes.bool,
  hintText: React.PropTypes.string,
  onBlur: React.PropTypes.func,
  onChange: React.PropTypes.func,
  onFocus: React.PropTypes.func,
  onKeyDown: React.PropTypes.func,
  onEnterKeyDown: React.PropTypes.func,
  type: React.PropTypes.string
}

TextField.defaultProps = {
  type: 'text',
}

export default TextField
