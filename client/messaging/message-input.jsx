import React, { PropTypes } from 'react'
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

  render() {
    const { className } = this.props
    const { message } = this.state
    return (<KeyListener onKeyPress={this.onKeyPress}>
        <TextField ref='messageInput' className={className} label='Send a message' value={message}
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
    if (event.charCode) {
      this.refs.messageInput.focus()
      this.setState({ message: this.state.message + String.fromCharCode(event.charCode) })
      return true
    }
    return false
  };
}
