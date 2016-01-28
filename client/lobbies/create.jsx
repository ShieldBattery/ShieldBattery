import React from 'react'
import FlatButton from '../material/flat-button.jsx'
import ValidatedForm from '../forms/validated-form.jsx'
import ValidatedText from '../forms/validated-text-input.jsx'
import maxLengthValidator from '../forms/max-length-validator'
import constants from '../../shared/constants'
import { closeDialog } from '../dialogs/dialog-action-creator'
import { createLobby } from './action-creators'
import styles from '../material/dialog.css'

class CreateLobbyOverlay extends React.Component {
  static contextTypes = {
    store: React.PropTypes.object.isRequired,
  };

  constructor(props) {
    super(props)
    this._focusTimeout = null
  }

  componentDidMount() {
    this._focusTimeout = setTimeout(() => {
      this.refs.create.focus()
      this._focusTimeout = null
    }, 0)
  }

  componentWillUnmount() {
    if (this._focusTimeout) {
      clearTimeout(this._focusTimeout)
    }
  }

  render() {
    const buttons = [
      <FlatButton label='Cancel' key='lobby-cancel-btn' color='accent'
          onClick={::this.onCancelClicked} />,
      <FlatButton ref='create' label='Create' key='lobby-create-btn' color='accent'
          onClick={() => this.onCreateClicked()} tabIndex={1}/>
    ]

    const lobbyNameValidator = maxLengthValidator(constants.LOBBY_NAME_MAXLENGTH,
        `Use at most ${constants.LOBBY_NAME_MAXLENGTH} characters`)

    return (
      <div role='dialog' className={styles.contents}>
        <ValidatedForm formTitle='Create game' ref='form' buttons={buttons}
              titleClassName={styles.title} fieldsClassName={styles.body}
              buttonsClassName={styles.actions} onSubmitted={values => this.onSubmitted(values)}>
          <ValidatedText hintText='Lobby name' floatingLabel={true} name='name' tabIndex={1}
              autoCapitalize='off' autoCorrect='off' spellCheck={false}
              required={true} requiredMessage='Enter a lobby name'
              validator={lobbyNameValidator}
              onEnterKeyDown={() => this.onCreateClicked()}/>
          {/* Leaving 'map' and 'numSlots' as text fields for now and without validation as they'll
              soon be replaced by our fancy-schmancy map distribution system */}
          <ValidatedText hintText='Map path' floatingLabel={true} name='map' tabIndex={1}
              required={true} requiredMessage='Enter a map path'
              autoCapitalize='off' autoCorrect='off' spellCheck={false}
              onEnterKeyDown={() => this.onCreateClicked()}/>
          <ValidatedText hintText='Number of slots' floatingLabel={true} name='numSlots'
              tabIndex={1} autoCapitalize='off' autoCorrect='off' spellCheck={false}
              required={true} requiredMessage='Enter number of slots'
              onEnterKeyDown={() => this.onCreateClicked()}/>
        </ValidatedForm>
      </div>
    )
  }

  onCreateClicked() {
    this.refs.form.trySubmit()
  }

  onCancelClicked() {
    this.context.store.dispatch(closeDialog())
  }

  onSubmitted(values) {
    this.context.store.dispatch(
        createLobby(values.get('name'), values.get('map'), values.get('numSlots')))
    this.context.store.dispatch(closeDialog())
  }
}

export default CreateLobbyOverlay
