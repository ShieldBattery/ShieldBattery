import React from 'react'
import { connect } from 'react-redux'
import { createLobby, getMapsList, navigateToLobby } from './action-creators'
import { closeOverlay } from '../activities/action-creators'
import { openSnackbar } from '../snackbars/action-creators'
import maxLengthValidator from '../forms/max-length-validator'
import { LOBBY_NAME_MAXLENGTH } from '../../shared/constants'

import Option from '../material/select/option.jsx'
import RaisedButton from '../material/raised-button.jsx'
import ValidatedForm from '../forms/validated-form.jsx'
import ValidatedSelect from '../forms/validated-select.jsx'
import ValidatedText from '../forms/validated-text-input.jsx'

const lobbyNameValidator = maxLengthValidator(LOBBY_NAME_MAXLENGTH,
    `Enter at most ${LOBBY_NAME_MAXLENGTH} characters`)

@connect(state => ({ maps: state.maps }))
export default class CreateLobby extends React.Component {
  constructor(props) {
    super(props)
    this.state = {
      defaultMap: null,
    }

    this._handleCreateClicked = ::this.onCreateClicked
    this._handleSubmitted = ::this.onSubmitted

    this._autoFocusTimer = null
  }

  componentWillMount() {
    const { maps } = this.props
    if (maps.list.size) {
      this.setState({ defaultMap: maps.list.get(0) })
    }
  }

  componentWillReceiveProps(nextProps) {
    const { maps: curMaps } = this.props
    const { maps: nextMaps } = nextProps
    if (!curMaps.list.size && nextMaps.list.size) {
      this.setState({ defaultMap: nextMaps.list.get(0) })
    } else if (!curMaps.lastError && nextMaps.lastError) {
      this.props.dispatch(closeOverlay())
      this.props.dispatch(openSnackbar('There was a problem loading the maps list'))
    }
  }

  componentDidMount() {
    this._autoFocusTimer = setTimeout(() => this._doAutoFocus(), 450)
    this.props.dispatch(getMapsList())
  }

  componentWillUnmount() {
    if (this._autoFocusTimer) {
      clearTimeout(this._autoFocusTimer)
      this._autoFocusTimer = null
    }
  }

  _doAutoFocus() {
    this._autoFocusTimer = null
    this.refs.form.getInputRef('name').focus()
  }

  render() {
    const { maps } = this.props

    const buttons = [
      <RaisedButton label='Create lobby' key='create' onClick={this._handleCreateClicked} />
    ]

    return (<ValidatedForm ref='form' formTitle={'Create lobby'} buttons={buttons}
        onSubmitted={this._handleSubmitted}>
      <ValidatedText label='Lobby name' floatingLabel={true} name='name' autoCapitalize='off'
          autoCorrect='off' spellCheck={false} required={true} requiredMessage='Enter a lobby name'
          validator={lobbyNameValidator} tabIndex={0}
          onEnterKeyDown={this._handleCreateClicked}/>
      <ValidatedSelect label='Map' name='map' tabIndex={0} defaultValue={this.state.defaultMap}
          disabled={!maps.list.size}>
          { maps.list.map(hash =>
                <Option key={hash} value={hash} text={maps.byHash.get(hash).name} />) }
      </ValidatedSelect>
    </ValidatedForm>)
  }

  onCreateClicked() {
    this.refs.form.trySubmit()
  }

  onSubmitted(values) {
    this.props.dispatch(createLobby(values.get('name'), values.get('map')))
    this.props.dispatch(navigateToLobby(values.get('name')))
    this.props.dispatch(closeOverlay())
  }
}
