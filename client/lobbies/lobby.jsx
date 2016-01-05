import React from 'react'
import styles from './view.css'

import Card from '../material/card.jsx'
import RaisedButton from '../material/raised-button.jsx'
import EmptySlot from './empty-slot.jsx'
import FilledSlot from './filled-slot.jsx'

export default class Lobby extends React.Component {
  static propTypes = {
    lobby: React.PropTypes.object.isRequired,
  }

  render() {
    const { lobby } = this.props
    const playersBySlot = lobby.players.valueSeq().reduce((result, p) => {
      result[p.slot] = p
      return result
    }, new Array(lobby.numSlots))

    const slots = new Array(lobby.numSlots)
    for (let i = 0; i < lobby.numSlots; i++) {
      if (playersBySlot[i]) {
        const { name, race, isComputer } = playersBySlot[i]
        slots[i] = <FilledSlot name={name} race={race} isComputer={isComputer} />
      } else {
        slots[i] = <EmptySlot />
      }
    }

    return (<div className={styles.contentArea}>
      <div className={styles.top}>
        <Card className={lobby.numSlots > 4 ? styles.slotsDense : styles.slotsSparse}>
          <div className={styles.slotColumn}>{slots}</div>
        </Card>
        <div className={styles.info}>
          <h3 className={styles.mapName}>{lobby.map}</h3>
          <img className={styles.mapThumbnail} src='/images/map-placeholder.jpg' />
          <div className={styles.infoItem}>
            <span className={styles.infoLabel}>Game type</span>
            <span className={styles.infoValue}>Melee</span>
          </div>
          <RaisedButton className={styles.startButton} color='primary' label='Start game' />
        </div>
      </div>
      <div className={styles.chat}>
        <p className={styles.chatHeader}>Chat</p>
      </div>
    </div>)
  }
}
