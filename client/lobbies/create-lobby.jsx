import { Range } from 'immutable'
import PropTypes from 'prop-types'
import React from 'react'
import { connect } from 'react-redux'
import styled from 'styled-components'
import { LOBBY_NAME_MAXLENGTH } from '../../common/constants'
import { ALL_GAME_TYPES, GameType, gameTypeToLabel } from '../../common/games/configuration'
import { isTeamType } from '../../common/lobbies'
import { closeOverlay, openOverlay } from '../activities/action-creators'
import form from '../forms/form'
import { composeValidators, maxLength, required } from '../forms/validators'
import KeyListener from '../keyboard/key-listener'
import MapSelect from '../maps/map-select'
import { RaisedButton } from '../material/button'
import { ScrollableContent } from '../material/scroll-bar'
import { Option } from '../material/select/option'
import { Select } from '../material/select/select'
import TextField from '../material/text-field'
import LoadingIndicator from '../progress/dots'
import { colorDividers } from '../styles/colors'
import { Headline5, subtitle1 } from '../styles/typography'
import {
  createLobby,
  getLobbyPreferences,
  navigateToLobby,
  updateLobbyPreferences,
} from './action-creators'
import { RecentMaps, recentMapsFromJs } from './lobby-preferences-reducer'

const ENTER = 'Enter'
const ENTER_NUMPAD = 'NumpadEnter'

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
    width: calc(50% - 10px);
  }
`

const SectionHeader = styled.div`
  ${subtitle1};
  margin: 16px 0;
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
  _lastSelectedMap = null

  componentDidMount() {
    this.updateGameSubType()
  }

  componentDidUpdate() {
    this.updateGameSubType()
  }

  renderSubTypeSelection() {
    const { bindCustom, getInputValue, recentMaps } = this.props

    const gameType = getInputValue('gameType')
    if (!isTeamType(gameType)) {
      return null
    }
    const selectedMap = recentMaps.byId.get(getInputValue('selectedMap'))
    if (!selectedMap) {
      return null
    }

    const {
      mapData: { slots },
    } = selectedMap
    if (gameType === GameType.TopVsBottom) {
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
            {ALL_GAME_TYPES.map(type => (
              <Option key={type} value={type} text={gameTypeToLabel(type)} />
            ))}
          </Select>
          {this.renderSubTypeSelection()}
        </GameTypeAndSubType>
        <SectionHeader>Select map</SectionHeader>
        <MapSelect
          {...bindCustom('selectedMap')}
          list={recentMaps.list}
          byId={recentMaps.byId}
          maxSelections={1}
          thumbnailSize='large'
          canBrowseMaps={true}
          onMapBrowse={onMapBrowse}
        />
      </form>
    )
  }

  updateGameSubType = () => {
    const { getInputValue, setInputValue, recentMaps } = this.props
    const gameType = getInputValue('gameType')
    const selectedMap = getInputValue('selectedMap')
    const map = recentMaps.byId.get(selectedMap)

    if (!selectedMap || !map) return

    // Ensure the `gameSubType` is always set to a default value when the `gameType` and/or the
    // `selectedMap` changes.
    if (this._lastGameType !== gameType || this._lastSelectedMap !== selectedMap) {
      this._lastGameType = gameType
      this._lastSelectedMap = selectedMap

      if (!isTeamType(gameType)) return

      if (gameType === 'topVBottom') {
        setInputValue('gameSubType', Math.ceil(map.mapData.slots / 2))
      } else {
        setInputValue('gameSubType', 2)
      }
    }
  }
}

@connect(state => ({ lobbyPreferences: state.lobbyPreferences }))
export default class CreateLobby extends React.Component {
  static propTypes = {
    map: PropTypes.object,
  }

  isHosted = false
  _autoFocusTimer = null
  _form = React.createRef()
  _input = React.createRef()

  state = {
    scrolledUp: false,
    scrolledDown: false,
    recentMaps: new RecentMaps(),
  }

  _savePreferences = () => {
    const { recentMaps } = this.state

    // This can happen if the component unmounts before the matchmaking preferences are finished
    // requesting (since the form won't be rendered in that case)
    if (!this._form.current) return

    let orderedRecentMaps = recentMaps.list
    // If the selected map is actually hosted, we move it to the front of the recent maps list
    if (this.isHosted) {
      const { selectedMap } = this._form.current.getModel()
      orderedRecentMaps = orderedRecentMaps
        .delete(orderedRecentMaps.indexOf(selectedMap))
        .unshift(selectedMap)
    }

    this.props.dispatch(
      updateLobbyPreferences({
        ...this._form.current.getModel(),
        recentMaps: orderedRecentMaps.toArray(),
      }),
    )
  }

  componentDidMount() {
    this.props.dispatch(getLobbyPreferences())
    window.addEventListener('beforeunload', this._savePreferences)
  }

  componentDidUpdate(prevProps) {
    const { isRequesting: prevIsRequesting } = prevProps.lobbyPreferences
    const { isRequesting, recentMaps } = this.props.lobbyPreferences
    const { map: initialMap } = this.props

    if (prevIsRequesting && !isRequesting) {
      let newRecentMaps = recentMaps

      if (initialMap && !recentMaps.byId.has(initialMap.id)) {
        newRecentMaps = recentMapsFromJs(
          [initialMap, ...recentMaps.byId.valueSeq().toArray()].slice(0, 5),
        )
      }

      this.setState({
        recentMaps: newRecentMaps,
      })

      this._autoFocusTimer = setTimeout(() => this._doAutoFocus(), 450)
    }
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
    if (this._input.current) this._input.current.focus()
  }

  render() {
    const { map: initialMap, lobbyPreferences } = this.props
    const { scrolledUp, scrolledDown, recentMaps } = this.state

    if (lobbyPreferences.isRequesting) {
      return (
        <LoadingArea>
          <LoadingIndicator />
        </LoadingArea>
      )
    }

    const { name, gameType, gameSubType } = lobbyPreferences
    const selectedMap = (initialMap && initialMap.id) || lobbyPreferences.selectedMap
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
          <Headline5>Create lobby</Headline5>
        </TitleBar>
        <Contents>
          {scrolledDown ? <ScrollDivider position='top' /> : null}
          <ScrollableContent onUpdate={this.onScrollUpdate}>
            <ContentsBody>
              <CreateLobbyForm
                ref={this._form}
                inputRef={this._input}
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
    const serverMapsProps = {
      title: 'Select map',
      onMapSelect: this.onMapSelect,
      onLocalMapSelect: this.onMapSelect,
    }
    this.props.dispatch(openOverlay('browseServerMaps', serverMapsProps))
  }

  onMapSelect = map => {
    this.props.dispatch(openOverlay('createLobby', { map }))
  }

  onCreateClick = () => {
    this._form.current.submit()
  }

  onSubmit = () => {
    this.isHosted = true

    const { name, gameType, gameSubType, selectedMap } = this._form.current.getModel()
    const subType = isTeamType(gameType) ? gameSubType : undefined

    this.props.dispatch(createLobby(name, selectedMap, gameType, subType))
    navigateToLobby(name)
    this.props.dispatch(closeOverlay())
  }

  onKeyDown = event => {
    if (event.code === ENTER || event.code === ENTER_NUMPAD) {
      this.onCreateClick()
      return true
    }

    return false
  }
}
