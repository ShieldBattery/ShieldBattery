import React from 'react'
import { connect } from 'react-redux'
import siteSocket from '../network/site-socket'
import { gameTypeToString } from './game-type'
import { joinLobby, navigateToLobby } from './action-creators'
import { closeOverlay } from '../activities/action-creators'
import styles from './join-lobby.css'

import MapThumbnail from './map-thumbnail.jsx'

class ListEntry extends React.Component {
  static propTypes = {
    lobby: React.PropTypes.object.isRequired,
    onClick: React.PropTypes.func.isRequired,
  };

  shouldComponentUpdate(nextProps) {
    return nextProps.lobby !== this.props.lobby || nextProps.onClick !== this.props.onClick
  }

  render() {
    const { lobby, onClick } = this.props

    return (<div className={styles.listEntry} onClick={() => onClick(lobby)}>
      <div className={styles.info}>
        <span className={styles.name}>{lobby.name}</span>
        <span className={styles.hostName}>{lobby.host.name}</span>
        <span className={styles.gameType}>{gameTypeToString(lobby.gameType)}</span>
        <span className={styles.openSlots}>{lobby.numSlots - lobby.filledSlots} slots open</span>
      </div>
      <div className={styles.map}>
        <MapThumbnail className={styles.mapThumbnail} map={lobby.map} />
        <span className={styles.mapName}>{lobby.map.name}</span>
      </div>
    </div>)
  }
}

@connect(state => ({ lobbyList: state.lobbyList }))
export default class JoinLobby extends React.Component {
  constructor(props) {
    super(props)
    this._handleLobbyClick = ::this.onLobbyClick
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
      return (<div className={styles.list}>
        <p className={styles.emptyText}>There are no active lobbies</p>
      </div>)
    }

    return (<div className={styles.list}>
      { list.map(name =>
            <ListEntry lobby={byName.get(name)} onClick={this._handleLobbyClick} key={name} />) }
    </div>)
  }

  render() {
    return (<div className={styles.root}>
      <p className={styles.title}>Join Lobby</p>
      { this.renderList() }
    </div>)
  }

  onLobbyClick(lobby) {
    this.props.dispatch(joinLobby(lobby.name))
    this.props.dispatch(navigateToLobby(lobby.name))
    this.props.dispatch(closeOverlay())
  }
}
