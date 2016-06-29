import React from 'react'
import { connect } from 'react-redux'
import FlatButton from '../material/flat-button.jsx'
import ValidatedForm from '../forms/validated-form.jsx'
import ValidatedText from '../forms/validated-text-input.jsx'
import composeValidators from '../forms/compose-validators'
import minLengthValidator from '../forms/min-length-validator'
import maxLengthValidator from '../forms/max-length-validator'
import regexValidator from '../forms/regex-validator'
import styles from '../material/dialog.css'

import { closeDialog } from '../dialogs/dialog-action-creator'
import { navigateToWhisper } from './action-creators'
import {
  USERNAME_MINLENGTH,
  USERNAME_MAXLENGTH,
  USERNAME_PATTERN,
} from '../../shared/constants'

@connect()
export default class CreateWhisper extends React.Component {
  constructor(props) {
    super(props)
    this._autoFocusTimer = null

    this._onSendMessageClicked = ::this.handleSendMessage
    this._onCanceledClicked = ::this.handleCanceled
    this._onSubmitted = ::this.handleFormSubmission
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
    this.refs.form.getInputRef('target').focus()
  }

  render() {
    const buttons = [
      <FlatButton label='Cancel' key='cancel' color='accent'
          onClick={this._onCanceledClicked} />,
      <FlatButton ref='send' label='Start' key='send' color='accent'
          onClick={this._onSendMessageClicked} />
    ]

    const usernameValidator = composeValidators(
      minLengthValidator(USERNAME_MINLENGTH,
          `Enter at least ${USERNAME_MINLENGTH} characters`),
      maxLengthValidator(USERNAME_MAXLENGTH,
          `Enter at most ${USERNAME_MAXLENGTH} characters`),
      regexValidator(USERNAME_PATTERN,
          'Username contains invalid characters')
    )

    return (
      <div role='whisper' className={styles.contents}>
        <div className={styles.body}>
          <ValidatedForm formTitle='Send a message' ref='form' buttons={buttons}
              titleClassName={styles.title} buttonsClassName={styles.actions}
              onSubmitted={this._onSubmitted}>
            <ValidatedText label='Username' floatingLabel={true} name='target' tabIndex={0}
                autoCapitalize='off' autoCorrect='off' spellCheck={false} required={true}
                requiredMessage='Enter a username' validator={usernameValidator}
                onEnterKeyDown={e => this.handleSendMessage()}/>
          </ValidatedForm>
        </div>
      </div>
    )
  }

  handleSendMessage() {
    this.refs.form.trySubmit()
  }

  handleCanceled() {
    this.props.dispatch(closeDialog())
  }

  handleFormSubmission(values) {
    const target = values.get('target')
    this.props.dispatch(closeDialog())
    this.props.dispatch(navigateToWhisper(target))
  }
}
