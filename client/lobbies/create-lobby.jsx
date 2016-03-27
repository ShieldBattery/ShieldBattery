import React from 'react'
import { connect } from 'react-redux'
import { createLobby } from './action-creators'
import { closeOverlay } from '../activities/action-creators'
import maxLengthValidator from '../forms/max-length-validator'
import { LOBBY_NAME_MAXLENGTH } from '../../shared/constants'
import styles from './create-lobby.css'

import RaisedButton from '../material/raised-button.jsx'
import ValidatedForm from '../forms/validated-form.jsx'
import ValidatedText from '../forms/validated-text-input.jsx'

const lobbyNameValidator = maxLengthValidator(LOBBY_NAME_MAXLENGTH,
    `Enter at most ${LOBBY_NAME_MAXLENGTH} characters`)

@connect(state => ({}))
export default class CreateLobby extends React.Component {
  constructor(props) {
    super(props)
    this._handleCreateClicked = ::this.onCreateClicked
    this._handleSubmitted = ::this.onSubmitted
  }

  render() {
    const buttons = [
      <RaisedButton label='Create lobby' key='create' onClick={this._handleCreateClicked} />
    ]

    return (<ValidatedForm ref='form' formTitle={'Create lobby'} buttons={buttons}
        onSubmitted={this._handleSubmitted}>
      <ValidatedText label='Lobby name' floatingLabel={true} name='name' autoCapitalize='off'
          autoCorrect='off' spellCheck={false} required={true} requiredMessage='Enter a lobby name'
          validator={lobbyNameValidator}
          onEnterKeyDown={this._handleCreateClicked}/>
    </ValidatedForm>)
  }

  onCreateClicked() {
    this.refs.form.trySubmit()
  }

  onSubmitted(values) {
    this.props.dispatch(createLobby(values.get('name'),
        'e364f0b60ea5f83c78afef5ec5a0c804d8480f1339e40ac0d8317d7a3968b5f3'))
    this.props.dispatch(closeOverlay())
  }
}
