import React from 'react'
import styles from './view.css'

import Card from '../material/card.jsx'
import RaisedButton from '../material/raised-button.jsx'
import TextField from '../material/text-field.jsx'
import EmptySlot from './empty-slot.jsx'
import FilledSlot from './filled-slot.jsx'
import ChatMessage from '../chat/message.jsx'

export default class Lobby extends React.Component {
  static propTypes = {
    lobby: React.PropTypes.object.isRequired,
    onSetRace: React.PropTypes.func,
    onAddComputer: React.PropTypes.func,
    onStartGame: React.PropTypes.func,
  };

  render() {
    const { lobby, onSetRace, onAddComputer, onStartGame } = this.props
    const playersBySlot = lobby.players.valueSeq().reduce((result, p) => {
      result[p.slot] = p
      return result
    }, new Array(lobby.numSlots))

    const slots = new Array(lobby.numSlots)
    for (let i = 0; i < lobby.numSlots; i++) {
      if (playersBySlot[i]) {
        const { id, name, race, isComputer } = playersBySlot[i]
        slots[i] = <FilledSlot key={i} name={name} race={race} isComputer={isComputer}
            onSetRace={onSetRace ? () => onSetRace(id, 'p') : undefined} />
      } else {
        slots[i] = <EmptySlot key={i}
            onAddComputer={onAddComputer ? () => this.props.onAddComputer(i) : undefined} />
      }
    }

    return (<div className={styles.contentArea}>
      <div className={styles.top}>
        <div className={styles.left}>
          <Card className={lobby.numSlots > 5 ? styles.slotsDense : styles.slotsSparse}>
            <div className={styles.slotColumn}>{slots}</div>
          </Card>
          <div className={styles.chat}>
            <ChatMessage user='tec27' timestamp='1:37 PM' text='gl hf' />
            <ChatMessage user='tec27' timestamp='1:38 PM' text='1a2a3a' />
            <ChatMessage user='dronebabo' timestamp='1:40 PM'
                text='i hope this goes better than last time' />
            <ChatMessage user='pachi' timestamp='1:41 PM'
                text={'What if we wrote a much longer message that had to wrap and stuff because' +
                    ' it was so long. How would that look, exactly? Would it look cool?'}/>
          </div>
          <TextField className={styles.chatInput} hintText='Send a message' />
        </div>

        <div className={styles.info}>
          <h3 className={styles.mapName}>{lobby.map}</h3>
          <img className={styles.mapThumbnail} src='/images/map-placeholder.jpg' />
          <div className={styles.infoItem}>
            <span className={styles.infoLabel}>Game type</span>
            <span className={styles.infoValue}>Melee</span>
          </div>
          <RaisedButton className={styles.startButton} color='primary' label='Start game'
              onClick={onStartGame}/>
        </div>
      </div>
    </div>)
  }
}
