import React from 'react'
import { Range } from 'immutable'
import { connect } from 'react-redux'
import styled from 'styled-components'

import { openOverlay, closeOverlay } from '../activities/action-creators'
import { composeValidators, maxLength, required } from '../forms/validators'
import { LOBBY_NAME_MAXLENGTH, GAME_TYPES } from '../../app/common/constants'
import gameTypeToString from './game-type-to-string'
import { isTeamType } from '../../app/common/lobbies'
import {
  createLobby,
  navigateToLobby,
  getLobbyPreferencesIfNeeded,
  updateLobbyPreferences,
} from './action-creators'

import KeyListener from '../keyboard/key-listener.jsx'
import LoadingIndicator from '../progress/dots.jsx'
import MapSelect from '../maps/map-select.jsx'
import Option from '../material/select/option.jsx'
import RaisedButton from '../material/raised-button.jsx'
import form from '../forms/form.jsx'
import Select from '../material/select/select.jsx'
import { ScrollableContent } from '../material/scroll-bar.jsx'
import TextField from '../material/text-field.jsx'

import { colorDividers, colorTextSecondary } from '../styles/colors'
import { Headline, Subheading } from '../styles/typography'

const ENTER = 'Enter'

const LoadingArea = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  height: 100%;
`

const Container = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
`

const TitleBar = styled.div`
  margin: 24px;

  & > h3 {
    margin: 0;
  }
`

const Contents = styled.div`
  flex-grow: 1;
`

const ContentsBody = styled.div`
  padding: 0 24px;
`

const ScrollDivider = styled.div`
  width: 100%;
  height: 1px;
  margin-top: ${props => (props.position === 'top' ? '-1px' : '0')};
  margin-bottom: ${props => (props.position === 'bottom' ? '-1px' : '0')};
  background-color: ${colorDividers};
`

const Actions = styled.div`
  margin: 16px 24px;
`

const GameTypeAndSubType = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: space-between;

  & > * {
    width: calc(50% - 20px);
  }
`

const Underline = styled(Subheading)`
  color: ${colorTextSecondary};
`

const lobbyNameValidator = composeValidators(
  required('Enter a lobby name'),
  maxLength(LOBBY_NAME_MAXLENGTH, `Enter at most ${LOBBY_NAME_MAXLENGTH} characters`),
)
const selectedMapValidator = required('Select a map to play')

@form({
  name: lobbyNameValidator,
  selectedMap: selectedMapValidator,
})
class CreateLobbyForm extends React.Component {
  _lastGameType = null
  _lastGameSubType = null
  _lastSelectedMap = null

  _updateLastValues() {
    const { getInputValue } = this.props
    this._lastGameType = getInputValue('gameType')
    this._lastGameSubType = getInputValue('gameSubType')
    this._lastSelectedMap = getInputValue('selectedMap')
  }

  componentDidMount() {
    this._updateLastValues()
  }

  componentDidUpdate() {
    this._updateLastValues()
  }

  componentWillUpdate(nextProps) {
    const { getInputValue, setInputValue, recentMaps } = nextProps
    const nextGameType = getInputValue('gameType')
    const nextGameSubType = getInputValue('gameSubType')
    const nextSelectedMap = getInputValue('selectedMap')

    if (!nextSelectedMap) return

    if (nextGameType !== this._lastGameType || nextSelectedMap !== this._lastSelectedMap) {
      if (!isTeamType(nextGameType)) return

      // Ensure `gameSubType` is always set, and always within a valid range for the current map
      const { slots } = recentMaps.byHash.get(nextSelectedMap)
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
    const { bindCustom, getInputValue, recentMaps } = this.props

    const gameType = getInputValue('gameType')
    if (!isTeamType(gameType)) {
      return null
    }
    const selectedMap = recentMaps.byHash.get(getInputValue('selectedMap'))
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
    const { onSubmit, bindInput, bindCustom, inputRef, recentMaps, onMapBrowse } = this.props

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
        <Underline>Select map</Underline>
        <MapSelect
          {...bindCustom('selectedMap')}
          maps={recentMaps.byHash.valueSeq().toArray()}
          maxSelections={1}
          thumbnailSize='large'
          canBrowseMaps={true}
          onMapBrowse={onMapBrowse}></MapSelect>
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
    scrolledUp: false,
    scrolledDown: false,
    hosted: false,
  }

  _savePreferences = () => {
    const {
      lobbyPreferences: { recentMaps },
    } = this.props
    const { hosted } = this.state

    let orderedRecentMaps = recentMaps.list
    // If the selected map is actually hosted, we move it to the front of the recent maps list
    if (hosted) {
      const { selectedMap } = this._form.getModel()
      orderedRecentMaps = orderedRecentMaps
        .delete(orderedRecentMaps.indexOf(selectedMap))
        .unshift(selectedMap)
    }

    this.props.dispatch(
      updateLobbyPreferences({
        ...this._form.getModel(),
        recentMaps: orderedRecentMaps.toArray(),
      }),
    )
  }

  componentDidMount() {
    this._autoFocusTimer = setTimeout(() => this._doAutoFocus(), 450)
    this.props.dispatch(getLobbyPreferencesIfNeeded())
    window.addEventListener('beforeunload', this._savePreferences)
  }

  componentWillUnmount() {
    if (this._autoFocusTimer) {
      clearTimeout(this._autoFocusTimer)
      this._autoFocusTimer = null
    }

    // Saves the lobby preferences if the component had time to unmount. If it didn't, eg. the page
    // was refreshed, the 'beforeunload' event listener will handle it.
    this._savePreferences()
    window.removeEventListener('beforeunload', this._savePreferences)
  }

  _doAutoFocus() {
    this._autoFocusTimer = null
    this._input.focus()
  }

  render() {
    const { lobbyPreferences } = this.props
    const { scrolledUp, scrolledDown } = this.state

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
      selectedMap,
    }

    return (
      <Container>
        <KeyListener onKeyDown={this.onKeyDown} />
        <TitleBar>
          <Headline>Create lobby</Headline>
        </TitleBar>
        <Contents>
          {scrolledDown ? <ScrollDivider position='top' /> : null}
          <ScrollableContent onUpdate={this.onScrollUpdate}>
            <ContentsBody>
              <CreateLobbyForm
                ref={this._setForm}
                inputRef={this._setInput}
                model={model}
                onSubmit={this.onSubmit}
                recentMaps={recentMaps}
                onMapBrowse={this.onMapBrowse}
              />
            </ContentsBody>
          </ScrollableContent>
          {scrolledUp ? <ScrollDivider position='bottom' /> : null}
        </Contents>
        <Actions>
          <RaisedButton label='Create lobby' onClick={this.onCreateClick} />
        </Actions>
      </Container>
    )
  }

  onScrollUpdate = values => {
    const { scrollTop, scrollHeight, clientHeight } = values
    const scrolledUp = scrollTop + clientHeight < scrollHeight
    const scrolledDown = scrollTop > 0

    if (scrolledUp !== this.state.scrolledUp || scrolledDown !== this.state.scrolledDown) {
      this.setState({ scrolledUp, scrolledDown })
    }
  }

  onMapBrowse = () => {
    this.props.dispatch(openOverlay('browseLocalMaps'))
  }

  onCreateClick = () => {
    this._form.submit()
  }

  onSubmit = () => {
    const { name, gameType, gameSubType, selectedMap } = this._form.getModel()
    const subType = isTeamType(gameType) ? gameSubType : undefined

    this.setState({ hosted: true })
    this.props.dispatch(createLobby(name, selectedMap, gameType, subType))
    this.props.dispatch(navigateToLobby(name))
    this.props.dispatch(closeOverlay())
  }

  onKeyDown = event => {
    if (event.code === ENTER) {
      this.onCreateClick()
      return true
    }

    return false
  }
}
