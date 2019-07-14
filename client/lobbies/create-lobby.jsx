import React from 'react'
import { Range } from 'immutable'
import { connect } from 'react-redux'
import { createLobby, navigateToLobby } from './action-creators'
import { getMapsList } from '../maps/action-creators'
import { openOverlay, closeOverlay } from '../activities/action-creators'
import { openSnackbar } from '../snackbars/action-creators'
import { composeValidators, maxLength, required } from '../forms/validators'
import { LOBBY_NAME_MAXLENGTH, GAME_TYPES } from '../../app/common/constants'
import gameTypeToString from './game-type-to-string'
import { isTeamType } from '../../app/common/lobbies'
import { MAP_UPLOADING } from '../../app/common/flags'
import styles from './create-lobby.css'

import Option from '../material/select/option.jsx'
import RaisedButton from '../material/raised-button.jsx'
import form from '../forms/form.jsx'
import Select from '../material/select/select.jsx'
import TextField from '../material/text-field.jsx'

const lobbyNameValidator = composeValidators(
  required('Enter a lobby name'),
  maxLength(LOBBY_NAME_MAXLENGTH, `Enter at most ${LOBBY_NAME_MAXLENGTH} characters`),
)

@form({
  name: lobbyNameValidator,
})
class CreateLobbyForm extends React.Component {
  _lastMapHash = null
  _lastGameType = null
  _lastGameSubType = null

  _updateLastValues() {
    const { getInputValue } = this.props
    this._lastMapHash = getInputValue('map')
    this._lastGameType = getInputValue('gameType')
    this._lastGameSubType = getInputValue('gameSubType')
  }

  componentDidMount() {
    this._updateLastValues()
  }

  componentDidUpdate() {
    this._updateLastValues()
  }

  componentWillUpdate(nextProps) {
    const { getInputValue, setInputValue, maps } = nextProps
    const nextGameType = getInputValue('gameType')
    const nextGameSubType = getInputValue('gameSubType')
    const nextMapHash = getInputValue('map')

    if (!nextMapHash) return

    if (nextGameType !== this._lastGameType || nextMapHash !== this._lastMapHash) {
      if (!isTeamType(nextGameType)) return

      // Ensure gameSubType is always set, and always within a valid range for the current map
      const { slots } = maps.byHash.get(nextMapHash)
      if (nextGameType === 'topVBottom') {
        if (
          nextGameType !== this._lastGameType ||
          !nextGameSubType ||
          nextGameSubType < 1 ||
          nextGameSubType >= slots
        ) {
          setInputValue('gameSubType', Math.ceil(slots / 2))
        }
      } else {
        if (
          nextGameType !== this._lastGameType ||
          !nextGameSubType ||
          nextGameSubType < 2 ||
          nextGameSubType > Math.min(slots, 4)
        ) {
          setInputValue('gameSubType', 2)
        }
      }
    }
  }

  renderSubTypeSelection() {
    const { bindCustom, getInputValue, maps } = this.props

    const gameType = getInputValue('gameType')
    if (!isTeamType(gameType)) {
      return null
    }
    const mapHash = getInputValue('map')
    if (!mapHash) {
      return null
    }

    const { slots } = maps.byHash.get(mapHash)
    if (gameType === 'topVBottom') {
      return (
        <Select {...bindCustom('gameSubType')} label='Teams' tabIndex={0}>
          {Range(slots - 1, 0).map(top => (
            <Option key={top} value={top} text={`${top} vs ${slots - top}`} />
          ))}
        </Select>
      )
    } else {
      return (
        <Select {...bindCustom('gameSubType')} label='Teams' tabIndex={0}>
          {Range(2, Math.min(slots, 4) + 1).map(numTeams => (
            <Option key={numTeams} value={numTeams} text={`${numTeams} teams`} />
          ))}
        </Select>
      )
    }
  }

  render() {
    const { onSubmit, bindInput, bindCustom, maps, inputRef } = this.props
    const mapListContents = maps.list.map(hash => (
      <Option key={hash} value={hash} text={maps.byHash.get(hash).name} />
    ))

    return (
      <form noValidate={true} onSubmit={onSubmit}>
        <TextField
          {...bindInput('name')}
          ref={inputRef}
          label='Lobby name'
          floatingLabel={true}
          inputProps={{
            autoCapitalize: 'off',
            autoComplete: 'off',
            autoCorrect: 'off',
            spellCheck: false,
            tabIndex: 0,
          }}
        />
        <div className={styles.selectMap}>
          <Select
            className={styles.mapList}
            {...bindCustom('map')}
            label='Map'
            tabIndex={0}
            disabled={!mapListContents.size}>
            {mapListContents}
          </Select>
          {MAP_UPLOADING ? (
            <RaisedButton
              className={styles.mapBrowse}
              label='Browse'
              onClick={this.props.onMapBrowse}
            />
          ) : null}
        </div>
        <Select {...bindCustom('gameType')} label='Game type' tabIndex={0}>
          {GAME_TYPES.map(type => (
            <Option key={type} value={type} text={gameTypeToString(type)} />
          ))}
        </Select>
        {this.renderSubTypeSelection()}
      </form>
    )
  }
}

@connect(state => ({ maps: state.maps }))
export default class CreateLobby extends React.Component {
  _autoFocusTimer = null
  _form = null
  _setForm = elem => {
    this._form = elem
  }
  _input = null
  _setInput = elem => {
    this._input = elem
  }

  componentWillReceiveProps(nextProps) {
    const { maps: curMaps } = this.props
    const { maps: nextMaps } = nextProps

    if (!curMaps.lastError && nextMaps.lastError) {
      this.props.dispatch(closeOverlay())
      this.props.dispatch(openSnackbar({ message: 'There was a problem loading the maps list' }))
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
      map: maps.list.get(0),
      gameType: 'melee',
    }

    return (
      <div className={styles.root}>
        <h3>Create lobby</h3>
        <CreateLobbyForm
          ref={this._setForm}
          inputRef={this._setInput}
          model={model}
          onSubmit={this.onSubmit}
          onMapBrowse={this.onMapBrowse}
          maps={maps}
        />
        <RaisedButton label='Create lobby' onClick={this.onCreateClick} />
      </div>
    )
  }

  onCreateClick = () => {
    this._form.submit()
  }

  onSubmit = () => {
    const { name, map, gameType, gameSubType } = this._form.getModel()
    const subType = isTeamType(gameType) ? gameSubType : undefined

    this.props.dispatch(createLobby(name, map, gameType, subType))
    this.props.dispatch(navigateToLobby(name))
    this.props.dispatch(closeOverlay())
  }

  onMapBrowse = () => {
    this.props.dispatch(openOverlay('browseMaps'))
  }
}
