import React from 'react'
import { Range } from 'immutable'
import { connect } from 'react-redux'
import styled from 'styled-components'

import { openOverlay, closeOverlay } from '../activities/action-creators'
import { composeValidators, maxLength, required } from '../forms/validators'
import { LOBBY_NAME_MAXLENGTH, GAME_TYPES } from '../../app/common/constants'
import gameTypeToString from './game-type-to-string'
import { isTeamType } from '../../app/common/lobbies'
import { MAP_UPLOADING } from '../../app/common/flags'
import {
  createLobby,
  navigateToLobby,
  getLobbyPreferencesIfNeeded,
  updateLobbyPreferences,
} from './action-creators'

import LoadingIndicator from '../progress/dots.jsx'
import Option from '../material/select/option.jsx'
import RaisedButton from '../material/raised-button.jsx'
import form from '../forms/form.jsx'
import Select from '../material/select/select.jsx'
import TextField from '../material/text-field.jsx'

const Container = styled.div`
  padding: 16px;
`

const LoadingArea = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  height: 100%;
`

const GameTypeAndSubType = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: space-between;

  & > * {
    width: calc(50% - 20px);
  }
`

const RecentMapsContainer = styled.div`
  /* display: flex;
  flex-direction: row;
  justify-content: flex-start;
  flex-wrap: wrap;*/
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-template-rows: repeat(2, 1fr);
  grid-column-gap: 4px;
  grid-row-gap: 4px;

  &::before {
    content: '';
    width: 0;
    padding-bottom: 100%;
    grid-row: 1 / 1;
    grid-column: 1 / 1;
  }

  & > *:first-child {
    grid-row: 1 / 1;
    grid-column: 1 / 1;
  }
`

const MapThumbnail = styled.div`
  background-color: white;
`

const lobbyNameValidator = composeValidators(
  required('Enter a lobby name'),
  maxLength(LOBBY_NAME_MAXLENGTH, `Enter at most ${LOBBY_NAME_MAXLENGTH} characters`),
)

@form({
  name: lobbyNameValidator,
})
class CreateLobbyForm extends React.Component {
  _lastGameType = null
  _lastGameSubType = null

  _updateLastValues() {
    const { getInputValue } = this.props
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
    const { getInputValue, setInputValue, selectedMap: nextSelectedMap } = nextProps
    const nextGameType = getInputValue('gameType')
    const nextGameSubType = getInputValue('gameSubType')

    if (!nextSelectedMap) return

    if (nextGameType !== this._lastGameType || nextSelectedMap !== this.props.selectedMap) {
      if (!isTeamType(nextGameType)) return

      // Ensure `gameSubType` is always set, and always within a valid range for the current map
      const { slots } = nextSelectedMap
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
    const { bindCustom, getInputValue, selectedMap } = this.props

    const gameType = getInputValue('gameType')
    if (!isTeamType(gameType)) {
      return null
    }
    if (!selectedMap) {
      return null
    }

    const { slots } = selectedMap
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
    const { onSubmit, bindInput, bindCustom, inputRef } = this.props

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
        <GameTypeAndSubType>
          <Select {...bindCustom('gameType')} label='Game type' tabIndex={0}>
            {GAME_TYPES.map(type => (
              <Option key={type} value={type} text={gameTypeToString(type)} />
            ))}
          </Select>
          {this.renderSubTypeSelection()}
        </GameTypeAndSubType>
      </form>
    )
  }
}

@connect(state => ({ lobbyPreferences: state.lobbyPreferences }))
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
  state = {
    selectedMap: this.props.lobbyPreferences.selectedMap,
  }

  componentDidMount() {
    this._autoFocusTimer = setTimeout(() => this._doAutoFocus(), 450)
    this.props.dispatch(getLobbyPreferencesIfNeeded())
  }

  componentWillUnmount() {
    if (this._autoFocusTimer) {
      clearTimeout(this._autoFocusTimer)
      this._autoFocusTimer = null
    }
    this.props.dispatch(
      updateLobbyPreferences({
        ...this._form.getModel(),
        recentMaps: this.props.lobbyPreferences.recentMaps.list.toArray(),
        selectedMap: this.state.selectedMap,
      }),
    )
  }

  _doAutoFocus() {
    this._autoFocusTimer = null
    this._input.focus()
  }

  renderRecentMaps() {
    const { recentMaps } = this.props
    const { selectedMap } = this.state

    return Range(0, 5).map(i => <MapThumbnail key={i} />)

    /* if (!recentMaps || recentMaps.list.size < 1) return null

    return recentMaps.list
      .slice(0, 5)
      .map(m =>
        <MapThumbnail onClick={() => this.onMapSelect(m.hash)}>m.title</MapThumbnail>(
          m.hash === selectedMap ? <span>V</span> : null,
        ),
      )*/
  }

  render() {
    const { lobbyPreferences } = this.props

    if (lobbyPreferences.isRequesting) {
      return (
        <LoadingArea>
          <LoadingIndicator />
        </LoadingArea>
      )
    }

    const { name, gameType, gameSubType, recentMaps, selectedMap } = lobbyPreferences
    const model = {
      name,
      gameType: gameType || 'melee',
      gameSubType,
    }

    return (
      <Container>
        <h3>Create lobby</h3>
        <CreateLobbyForm
          ref={this._setForm}
          inputRef={this._setInput}
          model={model}
          onSubmit={this.onSubmit}
          selectedMap={recentMaps.byHash.get(selectedMap)}
        />
        <div>Select map</div>
        <RecentMapsContainer>
          {this.renderRecentMaps()}
          {MAP_UPLOADING ? <RaisedButton label='Browse' onClick={this.onMapBrowse} /> : null}
        </RecentMapsContainer>
        <RaisedButton label='Create lobby' onClick={this.onCreateClick} />
      </Container>
    )
  }

  onMapBrowse = () => {
    this.props.dispatch(openOverlay('browseMaps'))
  }

  onMapSelect = map => {
    this.setState({
      selectedMap: map,
    })
  }

  onCreateClick = () => {
    this._form.submit()
  }

  onSubmit = () => {
    const { selectedMap } = this.state
    const { name, gameType, gameSubType } = this._form.getModel()
    const subType = isTeamType(gameType) ? gameSubType : undefined

    this.props.dispatch(createLobby(name, selectedMap, gameType, subType))
    this.props.dispatch(navigateToLobby(name))
    this.props.dispatch(closeOverlay())
  }
}
