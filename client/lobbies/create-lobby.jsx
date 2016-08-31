import React from 'react'
import { connect } from 'react-redux'
import { createLobby, getMapsList, navigateToLobby } from './action-creators'
import { closeOverlay } from '../activities/action-creators'
import { openSnackbar } from '../snackbars/action-creators'
import { composeValidators, maxLength, required } from '../forms/validators'
import { LOBBY_NAME_MAXLENGTH } from '../../shared/constants'

import Option from '../material/select/option.jsx'
import RaisedButton from '../material/raised-button.jsx'
import form from '../forms/form.jsx'
import Select from '../material/select/select.jsx'
import TextField from '../material/text-field.jsx'

const lobbyNameValidator = composeValidators(
    required('Enter a lobby name'),
    maxLength(LOBBY_NAME_MAXLENGTH, `Enter at most ${LOBBY_NAME_MAXLENGTH} characters`))

@form({
  name: lobbyNameValidator,
})
class CreateLobbyForm extends React.Component {
  render() {
    const { onSubmit, bindInput, bindCustom, maps, inputRef } = this.props
    return (<form noValidate={true} onSubmit={onSubmit}>
      <TextField {...bindInput('name')} ref={inputRef} label='Lobby name' floatingLabel={true}
          inputProps={{
            autoCapitalize: 'off',
            autoComplete: 'off',
            autoCorrect: 'off',
            spellCheck: false,
            tabIndex: 0,
          }}/>
      <Select {...bindCustom('map')} label='Map' tabIndex={0} disabled={!maps.list.size}>
          { maps.list.map(hash =>
                <Option key={hash} value={hash} text={maps.byHash.get(hash).name} />) }
      </Select>
    </form>)
  }
}

@connect(state => ({ maps: state.maps }))
export default class CreateLobby extends React.Component {
  state = {
    defaultMap: null,
  };
  _autoFocusTimer = null;
  _form = null;
  _setForm = elem => { this._form = elem };
  _input = null;
  _setInput = elem => { this._input = elem };

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
    this._input.focus()
  }

  render() {
    const { maps } = this.props

    const model = {
      map: this.state.defaultMap
    }

    return (<div>
      <h3>Create lobby</h3>
      <CreateLobbyForm ref={this._setForm} inputRef={this._setInput} model={model}
          onSubmit={this.onSubmit} maps={maps}/>
      <RaisedButton label='Create lobby' onClick={this.onCreateClick}/>
    </div>)
  }

  onCreateClick = () => {
    this._form.submit()
  };

  onSubmit = () => {
    const values = this._form.getModel()
    this.props.dispatch(createLobby(values.name, values.map))
    this.props.dispatch(navigateToLobby(values.name))
    this.props.dispatch(closeOverlay())
  };
}
