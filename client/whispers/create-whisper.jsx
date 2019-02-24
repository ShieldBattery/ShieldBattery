import React from 'react'
import { connect } from 'react-redux'
import Dialog from '../material/dialog.jsx'
import FlatButton from '../material/flat-button.jsx'
import form from '../forms/form.jsx'
import TextField from '../material/text-field.jsx'
import { composeValidators, minLength, maxLength, regex, required } from '../forms/validators'

import { closeDialog } from '../dialogs/dialog-action-creator'
import { navigateToWhisper } from './action-creators'
import {
  USERNAME_MINLENGTH,
  USERNAME_MAXLENGTH,
  USERNAME_PATTERN,
} from '../../app/common/constants'

const usernameValidator = composeValidators(
  required('Enter a username'),
  minLength(USERNAME_MINLENGTH, `Enter at least ${USERNAME_MINLENGTH} characters`),
  maxLength(USERNAME_MAXLENGTH, `Enter at most ${USERNAME_MAXLENGTH} characters`),
  regex(USERNAME_PATTERN, 'Username contains invalid characters'),
)

@form({
  target: usernameValidator,
})
class CreateWhisperForm extends React.Component {
  render() {
    const { onSubmit, bindInput, inputRef } = this.props
    return (
      <form noValidate={true} onSubmit={onSubmit}>
        <TextField
          {...bindInput('target')}
          label='Username'
          floatingLabel={true}
          ref={inputRef}
          inputProps={{
            autoCapitalize: 'off',
            autoCorrect: 'off',
            spellCheck: 'off',
            tabIndex: 0,
          }}
        />
      </form>
    )
  }
}

@connect()
export default class CreateWhisper extends React.Component {
  _autoFocusTimer = null
  _form = null
  _setForm = elem => {
    this._form = elem
  }
  _input = null
  _setInput = elem => {
    this._input = elem
  }

  componentDidMount() {
    this._autoFocusTimer = setTimeout(() => this._doAutoFocus(), 450)
  }

  componentWillUnmount() {
    if (this._autoFocusTimer) {
      clearTimeout(this._autoFocusTimer)
      this._autoFocusTimer = null
    }
  }

  _doAutoFocus() {
    this._autoFocusTimer = null
    this._input.focus()
  }

  render() {
    const buttons = [
      <FlatButton label='Cancel' key='cancel' color='accent' onClick={this.props.onCancel} />,
      <FlatButton label='Start' key='send' color='accent' onClick={this.onSendMessage} />,
    ]

    return (
      <Dialog title={'Send a message'} buttons={buttons} onCancel={this.props.onCancel}>
        <CreateWhisperForm
          ref={this._setForm}
          inputRef={this._setInput}
          model={{}}
          onSubmit={this.onSubmit}
        />
      </Dialog>
    )
  }

  onSendMessage = () => {
    this._form.submit()
  }

  onSubmit = () => {
    const target = this._form.getModel().target
    this.props.dispatch(closeDialog())
    this.props.dispatch(navigateToWhisper(target))
  }
}
