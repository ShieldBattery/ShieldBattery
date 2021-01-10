import React from 'react'
import PropTypes from 'prop-types'
import styled from 'styled-components'
import { connect } from 'react-redux'
import siteSocket from '../network/site-socket'
import gameTypeToString from './game-type-to-string'
import { joinLobby, navigateToLobby } from './action-creators'
import { closeOverlay } from '../activities/action-creators'

import MapThumbnail from '../maps/map-thumbnail'
import { colorDividers } from '../styles/colors'
import { HeadlineOld, SubheadingOld, Body2Old, TitleOld } from '../styles/typography'

const ListEntryRoot = styled.div`
  width: 100%;
  padding-left: 16px;
  padding-right: 16px;
  padding-bottom: 7px;

  display: flex;
  align-items: center;

  &:hover {
    cursor: pointer;
    background-color: rgba(255, 255, 255, 0.08);
  }

  &:first-child {
    padding-top: 8px;
  }

  &:last-child {
    padding-bottom: 8px;
  }

  & + & {
    padding-top: 8px;
    border-top: 1px solid ${colorDividers};
  }
`

const Info = styled.div`
  display: flex;
  flex-direction: column;
  flex-grow: 1;
`

const MapPreview = styled.div`
  width: 128px;
  height: 128px;
  position: relative;

  flex-shrink: 0;
  margin-left: 8px;
`

class ListEntry extends React.Component {
  static propTypes = {
    lobby: PropTypes.object.isRequired,
    onClick: PropTypes.func.isRequired,
  }

  shouldComponentUpdate(nextProps) {
    return nextProps.lobby !== this.props.lobby || nextProps.onClick !== this.props.onClick
  }

  render() {
    const { lobby, onClick } = this.props

    return (
      <ListEntryRoot onClick={() => onClick(lobby)}>
        <Info>
          <HeadlineOld as='span'>{lobby.name}</HeadlineOld>
          <SubheadingOld as='span'>{lobby.host.name}</SubheadingOld>
          <Body2Old as='span'>{gameTypeToString(lobby.gameType)}</Body2Old>
          <Body2Old as='span'>{lobby.openSlotCount} slots open</Body2Old>
        </Info>
        <MapPreview>
          <MapThumbnail map={lobby.map} showMapName={true} canHover={false} />
        </MapPreview>
      </ListEntryRoot>
    )
  }
}

const Root = styled.div`
  padding: 16px;
`

const Header = styled(TitleOld)`
  margin-top: 8px;
`

@connect(state => ({ lobbyList: state.lobbyList }))
export default class JoinLobby extends React.Component {
  constructor(props) {
    super(props)
    this._handleLobbyClick = this.onLobbyClick.bind(this)
  }

  componentDidMount() {
    siteSocket.invoke('/lobbies/subscribe')
  }

  componentWillUnmount() {
    siteSocket.invoke('/lobbies/unsubscribe')
  }

  renderList() {
    const { byName, list } = this.props.lobbyList
    if (!list.size) {
      return (
        <div>
          <SubheadingOld as='p'>There are no active lobbies</SubheadingOld>
        </div>
      )
    }

    const openLobbies = list.filter(name => byName.get(name).openSlotCount > 0)
    return (
      <div>
        {!openLobbies.isEmpty() ? (
          openLobbies.map(name => (
            <ListEntry key={name} lobby={byName.get(name)} onClick={this._handleLobbyClick} />
          ))
        ) : (
          <SubheadingOld as='p'>There are no open lobbies</SubheadingOld>
        )}
      </div>
    )
  }

  render() {
    return (
      <Root>
        <Header as='p'>Join Lobby</Header>
        {this.renderList()}
      </Root>
    )
  }

  onLobbyClick(lobby) {
    this.props.dispatch(joinLobby(lobby.name))
    this.props.dispatch(navigateToLobby(lobby.name))
    this.props.dispatch(closeOverlay())
  }
}
