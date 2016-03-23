import React from 'react'
import styles from './view.css'

import Card from '../material/card.jsx'
import RaisedButton from '../material/raised-button.jsx'
import TextField from '../material/text-field.jsx'
import EmptySlot from './empty-slot.jsx'
import FilledSlot from './filled-slot.jsx'
import MapThumbnail from './map-thumbnail.jsx'
import ChatMessage from '../chat/message.jsx'

export default class Lobby extends React.Component {
  static propTypes = {
    lobby: React.PropTypes.object.isRequired,
    chat: React.PropTypes.object.isRequired,
    user: React.PropTypes.object,
    onSetRace: React.PropTypes.func,
    onAddComputer: React.PropTypes.func,
    onSendChatMessage: React.PropTypes.func,
  };

  constructor(props) {
    super(props)
    this._handleChatEnter = ::this.onChatEnter
  }

  renderChat() {
    return (<div className={styles.chat}>
      {
        this.props.chat.map(msg =>
            <ChatMessage user={msg.from} time={msg.time} text={msg.text} />)
      }
    </div>)
  }

  render() {
    const { lobby, onSetRace, onAddComputer, user } = this.props
    const playersBySlot = lobby.players.valueSeq().reduce((result, p) => {
      result[p.slot] = p
      return result
    }, new Array(lobby.numSlots))

    const isHost = lobby.players.get(lobby.hostId).name === user.name

    const slots = new Array(lobby.numSlots)
    for (let i = 0; i < lobby.numSlots; i++) {
      if (playersBySlot[i]) {
        const { id, name, race, isComputer } = playersBySlot[i]
        const controllable = (isComputer && isHost) || (!isComputer && name === user.name)
        slots[i] = <FilledSlot key={i} name={name} race={race} isComputer={isComputer}
            controllable={controllable}
            onSetRace={onSetRace ? race => onSetRace(id, race) : undefined} />
      } else {
        if (isHost) {
          slots[i] = <EmptySlot key={i} controllable={true}
              onAddComputer={onAddComputer ? () => this.props.onAddComputer(i) : undefined} />
        } else {
          slots[i] = <EmptySlot key={i} controllable={false} />
        }
      }
    }

    return (<div className={styles.contentArea}>
      <div className={styles.left}>
        <Card className={lobby.numSlots > 5 ? styles.slotsDense : styles.slotsSparse}>
          <div className={styles.slotColumn}>{slots}</div>
        </Card>
        { this.renderChat() }
        <TextField ref='chatEntry' className={styles.chatInput} label='Send a message'
            maxlength={500} floatingLabel={false} allowErrors={false}
            onEnterKeyDown={this._handleChatEnter}/>
      </div>

      <div className={styles.info}>
        <h3 className={styles.mapName}>{lobby.map.name}</h3>
        <MapThumbnail className={styles.mapThumbnail} map={lobby.map} />
        <div className={styles.infoItem}>
          <span className={styles.infoLabel}>Game type</span>
          <span className={styles.infoValue}>Melee</span>
        </div>
        { this.renderCountdown() }
        { this.renderStartButton() }
      </div>
    </div>)
  }

  renderCountdown() {
    const { lobby } = this.props
    if (!lobby.isCountingDown) {
      return null
    }

    return <h3 className={styles.countdown}>{lobby.countdownTimer}</h3>
  }

  renderStartButton() {
    const { lobby, user, onStartGame } = this.props
    const hostPlayer = lobby.players.get(lobby.hostId)
    if (!user || hostPlayer.name !== user.name) {
      return null
    }

    const isDisabled = lobby.isCountingDown || lobby.players.size < 2
    return (<RaisedButton className={styles.startButton} color='primary' label='Start game'
        disabled={isDisabled} onClick={onStartGame}/>)
  }

  onChatEnter() {
    if (this.props.onSendChatMessage) {
      this.props.onSendChatMessage(this.refs.chatEntry.getValue())
    }
    this.refs.chatEntry.clearValue()
  }
}
