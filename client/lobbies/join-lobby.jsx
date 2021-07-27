import PropTypes from 'prop-types'
import React from 'react'
import { connect } from 'react-redux'
import styled from 'styled-components'
import { gameTypeToLabel } from '../../common/games/configuration'
import { closeOverlay } from '../activities/action-creators'
import { MapThumbnail } from '../maps/map-thumbnail'
import siteSocket from '../network/site-socket'
import { colorDividers } from '../styles/colors'
import { Body1, headline5, Headline6, Subtitle1, Subtitle2 } from '../styles/typography'
import { joinLobby, navigateToLobby } from './action-creators'

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
          <Headline6>{lobby.name}</Headline6>
          <Subtitle2>{lobby.host.name}</Subtitle2>
          <Body1>{gameTypeToLabel(lobby.gameType)}</Body1>
          <Body1>{lobby.openSlotCount} slots open</Body1>
        </Info>
        <MapPreview>
          <MapThumbnail map={lobby.map} showMapName={true} canHover={false} />
        </MapPreview>
      </ListEntryRoot>
    )
  }
}

const Root = styled.div`
  padding: 16px 24px;
`

const Header = styled.div`
  ${headline5};
  margin-top: 8px;
  margin-bottom: 24px;
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
          <Subtitle1>There are no active lobbies</Subtitle1>
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
          <Subtitle1>There are no open lobbies</Subtitle1>
        )}
      </div>
    )
  }

  render() {
    return (
      <Root>
        <Header>Join Lobby</Header>
        {this.renderList()}
      </Root>
    )
  }

  onLobbyClick(lobby) {
    this.props.dispatch(joinLobby(lobby.name))
    this.props.dispatch(closeOverlay())
    navigateToLobby(lobby.name)
  }
}
