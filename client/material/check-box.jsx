import React from 'react'
import classnames from 'classnames'
import uniqueId from '../dom/unique-id'

class CheckBox extends React.Component {
  constructor(props) {
    super(props)
    this.id = uniqueId()
    this.state = {
      checked: props.defaultChecked,
      isKeyboardFocused: false,
    }
    this.mouseActive = false
    this.clearMouseActive = null
  }

  componentDidMount() {
    let node = this.refs.input.getDOMNode()
    if (node.checked != this.state.checked) {
      this.setState({ checked: node.checked })
    }
  }

  componentWillReceiveProps(nextProps) {
    if (nextProps.hasOwnProperty('checked')) {
      this.setState({ checked: nextProps.checked })
    }
  }

  render() {
    let classes = classnames('check-box', this.props.className, {
      checked: this.state.checked,
      disabled: this.props.disabled,
      focused: this.state.isKeyboardFocused,
    })

    let labelElem = this.props.label ?
        <label htmlFor={this.id}>{this.props.label}</label> : null

    let iconElem = <div className='check-box-icon'></div>

    let inputProps = {
      ref: 'input',
      type: 'checkbox',
      id: this.id,
      onBlur: e => this._handleBlur(e),
      onFocus: e => this._handleFocus(e),
      onMouseUp: e => this._handleMouseUp(e),
      onMouseDown: e => this._handleMouseDown(e),
      onMouseOut: e => this._handleMouseOut(e),
      onChange: e => this._handleChange(e),
    }
    let inputElem = <input {...this.props} {...inputProps} />

    return (<div className={classes}>
      {inputElem}
      <div className="check-box-icon-container">
        {iconElem}
      </div>
      {labelElem}
    </div>)
  }

  isChecked() {
    return this.refs.input.getDOMNode().checked
  }

  setChecked(checked) {
    if (!this.props.hasOwnProperty('checked') || this.props.checked === false) {
        this.setState({ checked: checked })
        this.refs.input.getDOMNode().checked = checked
    }
  }

  getValue() {
    return this.refs.input.getDOMNode().value
  }

  isKeyboardFocused() {
    return this.state.isKeyboardFocused
  }

  _handleChange(e) {
    let inputChecked = this.refs.input.getDOMNode().checked
    if (!this.props.hasOwnProperty('checked')) {
      let newState = { checked: inputChecked }
      if (!this.mouseActive) {
        newState.isKeyboardFocused = true
      }

      this.setState(newState)
      if (this.props.onChange) {
        this.props.onChange(e, inputChecked)
      }
    }
  }

  _handleBlur(e) {
    if (this.state.isKeyboardFocused) {
      this.setState({ isKeyboardFocused: false })
    }
  }

  _handleFocus(e) {
    if (!this.mouseActive) {
      this.setState({ isKeyboardFocused: true })
    }
  }

  _handleMouseUp(e) {
    // TODO(tec27): ripples
  }

  _handleMouseOut(e) {
    // TODO(tec27): ripples
  }

  _handleMouseDown(e) {
    if (this.clearMouseActive) {
      clearTimeout(this.clearMouseActive)
    }
    this.clearMouseActive = setTimeout(() => {
      this.mouseActive = false
      this.clearMouseActive = null
    }, 100)
    this.mouseActive = true
  }
}

CheckBox.propTypes = {
  name: React.PropTypes.string,
  label: React.PropTypes.string,
  value: React.PropTypes.string,
  onChange: React.PropTypes.func,
  disabled: React.PropTypes.bool,
  defaultChecked: React.PropTypes.bool,
  className: React.PropTypes.oneOfType([
    React.PropTypes.string,
    React.PropTypes.array,
    React.PropTypes.object,
  ])
}

export default CheckBox
