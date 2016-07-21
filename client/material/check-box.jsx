import React from 'react'
import classnames from 'classnames'
import uniqueId from '../dom/unique-id'
import styles from './check-box.css'

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
    const node = this.refs.input
    if (node.checked !== this.state.checked) {
      // Disabling lint as I think this is the only way to really do this, unfortunately
      this.setState({ checked: node.checked }) // eslint-disable-line react/no-did-mount-set-state
    }
  }

  componentWillReceiveProps(nextProps) {
    const hasNewDefault = nextProps.hasOwnProperty('defaultChecked') &&
        nextProps.defaultChecked !== this.props.defaultChecked

    if (hasNewDefault) {
      this.setState({ checked: nextProps.defaultChecked })
    }

    if (nextProps.hasOwnProperty('checked') && nextProps.checked !== this.props.checked) {
      this.setState({ checked: nextProps.checked })
    }
  }

  render() {
    const { className, label, ...restProps } = this.props
    const classes = classnames(styles.checkBox, className, {
      [styles.checked]: this.state.checked,
      [styles.disabled]: this.props.disabled,
      [styles.focused]: this.state.isKeyboardFocused,
    })

    const labelElem = label ? <label htmlFor={this.id}>{this.props.label}</label> : null
    const iconElem = <div className={styles.icon}></div>

    const inputProps = Object.assign({}, restProps, {
      ref: 'input',
      type: 'checkbox',
      id: this.id,
      onBlur: e => this._handleBlur(e),
      onFocus: e => this._handleFocus(e),
      onMouseUp: e => this._handleMouseUp(e),
      onMouseDown: e => this._handleMouseDown(e),
      onMouseOut: e => this._handleMouseOut(e),
      onChange: e => this._handleChange(e),
    })
    delete inputProps.validationError
    const inputElem = <input {...inputProps} />

    return (<div className={classes}>
      {inputElem}
      <div className={styles.iconContainer}>
        {iconElem}
      </div>
      {labelElem}
    </div>)
  }

  isChecked() {
    return this.refs.input.checked
  }

  setChecked(checked) {
    if (!this.props.hasOwnProperty('checked') || this.props.checked === false) {
      this.setState({ checked })
      this.refs.input.checked = checked
    }
  }

  getValue() {
    return this.refs.input.value
  }

  isKeyboardFocused() {
    return this.state.isKeyboardFocused
  }

  _handleChange(e) {
    const inputChecked = this.refs.input.checked
    if (!this.props.hasOwnProperty('checked')) {
      const newState = { checked: inputChecked }
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
