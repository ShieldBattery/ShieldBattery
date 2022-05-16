import React from 'react'
import { connect } from 'react-redux'
import { CHANNEL_MAXLENGTH, CHANNEL_PATTERN } from '../../common/constants'
import { closeDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import form from '../forms/form'
import { composeValidators, maxLength, regex, required } from '../forms/validators'
import { TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { TextField } from '../material/text-field'
import { navigateToChannel } from './action-creators'

const channelValidator = composeValidators(
  required('Enter a channel name'),
  maxLength(CHANNEL_MAXLENGTH, `Enter at most ${CHANNEL_MAXLENGTH} characters`),
  regex(CHANNEL_PATTERN, 'Channel name contains invalid characters'),
)

@form({
  channel: channelValidator,
})
class JoinChannelForm extends React.Component {
  render() {
    const { onSubmit, bindInput, inputRef } = this.props
    return (
      <form noValidate={true} onSubmit={onSubmit}>
        <TextField
          {...bindInput('channel')}
          label='Channel name'
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
export default class JoinChannel extends React.Component {
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
      <TextButton label='Cancel' key='cancel' color='accent' onClick={this.props.onCancel} />,
      <TextButton label='Join' key='join' color='accent' onClick={this.onJoinChannel} />,
    ]

    return (
      <Dialog
        title={'Join channel'}
        buttons={buttons}
        onCancel={this.props.onCancel}
        dialogRef={this.props.dialogRef}>
        <JoinChannelForm
          ref={this._setForm}
          inputRef={this._setInput}
          model={{}}
          onSubmit={this.onSubmit}
        />
      </Dialog>
    )
  }

  onJoinChannel = () => {
    this._form.submit()
  }

  onSubmit = () => {
    const channel = this._form.getModel().channel
    this.props.dispatch(closeDialog(DialogType.ChannelJoin))
    navigateToChannel(channel)
  }
}
