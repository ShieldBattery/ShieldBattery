import React from 'react'
import PropTypes from 'prop-types'
import TextField from '../material/text-field.jsx'
import KeyListener from '../keyboard/key-listener.jsx'

export default class MessageInput extends React.Component {
  static propTypes = {
    className: PropTypes.any,
    onSend: PropTypes.func.isRequired,
  };
  state = {
    message: ''
  };
  _ref = null;
  _setRef = elem => { this._ref = elem };

  render() {
    const { className } = this.props
    const { message } = this.state
    return (<KeyListener onKeyPress={this.onKeyPress}>
      <TextField ref={this._setRef} className={className} label='Send a message' value={message}
        maxLength={500} floatingLabel={false} allowErrors={false}
        inputProps={{ autoComplete: 'off' }}
        onEnterKeyDown={this.onEnterKeyDown} onChange={this.onChange}/>
    </KeyListener>)
  }

  onChange = e => {
    const { value } = e.target
    if (value !== this.state.message) {
      this.setState({ message: value })
    }
  };

  onEnterKeyDown = () => {
    if (this.state.message) {
      this.props.onSend(this.state.message)
      this.setState({ message: '' })
    }
  };

  onKeyPress = event => {
    if (event.target === this._ref ||
        event.ctrlKey || event.altKey ||
        ['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName)) {
      return false
    }

    const key = event.key ? event.key : String.fromCharCode(event.charCode)
    if (key && key.length === 1) {
      if (key === ' ' && event.target.tagName === 'BUTTON') {
        // Space bar should click the button, rather than doing any of this
        return false
      }

      this._ref.focus()
      this.setState({ message: this.state.message + key })
      return true
    }

    return false
  };
}
