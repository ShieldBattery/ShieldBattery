import React from 'react'
import styles from './loading.css'

import Card from '../material/card.jsx'
import Avatar from '../avatars/avatar.jsx'

class LoadingPlayer extends React.Component {
  static propTypes = {
    player: React.PropTypes.object.isRequired,
    isReady: React.PropTypes.bool,
  };

  render() {
    const { player, isReady } = this.props

    return (<Card className={isReady ? styles.readyPlayer : styles.player}>
      <Avatar user={player.name} className={styles.playerAvatar} />
      <span className={styles.playerName}>{player.name}</span>
      <span className={styles.slotRace}>{player.race}</span>
    </Card>)
  }
}

export default class LoadingScreen extends React.Component {
  static propTypes = {
    lobby: React.PropTypes.object.isRequired,
    gameStatus: React.PropTypes.object.isRequired,
    user: React.PropTypes.object.isRequired,
  };

  render() {
    const { lobby, gameStatus, user } = this.props

    const isReady = p => {
      if (p.isComputer || p.name === user.name) return true
      if (gameStatus.state === 'starting' || gameStatus.state === 'playing') return true
      if (gameStatus.state !== 'awaitingPlayers') return false

      return gameStatus.extra ? !gameStatus.extra.includes(p.name) : true
    }

    const playerElems =
        lobby.players.valueSeq()
          .sort((a, b) => a.slot - b.slot)
          .map(p => <LoadingPlayer key={p.id} player={p} isReady={isReady(p)} />)

    return (<div className={styles.content}>
      <div className={styles.typeAndMap}>
        <span className={styles.gameType}>Melee</span>
        <span className={styles.gameTypeMapBridge}> on </span>
        <span className={styles.mapName}>{lobby.map}</span>
      </div>
      <div>
        <img className={styles.mapThumbnail} src='/images/map-placeholder.jpg' />
      </div>
      <div className={styles.players}>{playerElems}</div>
      <span className={styles.loadingMessage}>Refining dragoon pathing&hellip;</span>
    </div>)
  }
}
