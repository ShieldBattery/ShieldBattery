import React, { PropTypes } from 'react'
import ReactDom from 'react-dom'
import styles from './view.css'

import Card from '../material/card.jsx'
import RaisedButton from '../material/raised-button.jsx'
import TextField from '../material/text-field.jsx'
import EmptySlot from './empty-slot.jsx'
import FilledSlot from './filled-slot.jsx'
import MapThumbnail from './map-thumbnail.jsx'
import { ChatMessageLayout, ChatMessage } from '../chat/message.jsx'

class JoinMessage extends React.Component {
  static propTypes = {
    time: PropTypes.number.isRequired,
    name: PropTypes.string.isRequired,
  };

  render() {
    return (<ChatMessageLayout time={this.props.time} className={styles.chatSystemMessage}>
      <span>
        &gt;&gt; <span className={styles.chatImportant}>{this.props.name}</span> has joined the
        lobby
      </span>
    </ChatMessageLayout>)
  }
}

class LeaveMessage extends React.Component {
  static propTypes = {
    time: PropTypes.number.isRequired,
    name: PropTypes.string.isRequired,
  };

  render() {
    return (<ChatMessageLayout time={this.props.time} className={styles.chatSystemMessage}>
      <span>
        &lt;&lt; <span className={styles.chatImportant}>{this.props.name}</span> has left the
        lobby
      </span>
    </ChatMessageLayout>)
  }
}

class SelfJoinMessage extends React.Component {
  static propTypes = {
    time: PropTypes.number.isRequired,
    lobby: PropTypes.string.isRequired,
    host: PropTypes.string.isRequired,
  };

  render() {
    return (<ChatMessageLayout time={this.props.time} className={styles.chatSystemMessage}>
        <span>
          You have joined <span className={styles.chatImportant}>{this.props.lobby}</span>. The host
          is <span className={styles.chatImportant}>{this.props.host}</span>.
        </span>
    </ChatMessageLayout>)
  }
}

class HostChangeMessage extends React.Component {
  static propTypes = {
    time: PropTypes.number.isRequired,
    name: PropTypes.string.isRequired,
  };

  render() {
    return (<ChatMessageLayout time={this.props.time} className={styles.chatSystemMessage}>
        <span>
          <span className={styles.chatImportant}>{this.props.name}</span> is now the host
        </span>
    </ChatMessageLayout>)
  }
}

class ChatList extends React.Component {
  static propTypes = {
    messages: PropTypes.object.isRequired,
  };

  constructor(props) {
    super(props)
    this._shouldAutoScroll = true
  }

  shouldComponentUpdate(nextProps) {
    return nextProps.messages !== this.props.messages
  }

  componentWillUpdate() {
    const node = ReactDom.findDOMNode(this)
    this._shouldAutoScroll = (node.scrollTop + node.offsetHeight) >= node.scrollHeight
  }

  componentDidUpdate() {
    if (this._shouldAutoScroll) {
      const node = ReactDom.findDOMNode(this)
      node.scrollTop = node.scrollHeight
    }
  }

  renderMessage(msg) {
    const { id, type, time } = msg
    switch (type) {
      case 'message': return <ChatMessage key={id} user={msg.from} time={time} text={msg.text} />
      case 'join': return <JoinMessage time={time} name={msg.name} />
      case 'leave': return <LeaveMessage time={time} name={msg.name} />
      case 'selfJoin': return <SelfJoinMessage time={time} lobby={msg.lobby} host={msg.host} />
      case 'hostChange': return <HostChangeMessage time={time} name={msg.name} />
      default: return null
    }
  }

  render() {
    return (<div className={styles.chat}>
      { this.props.messages.map(msg => this.renderMessage(msg)) }
    </div>)
  }
}

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
        <ChatList messages={this.props.chat} />
        <TextField ref='chatEntry' className={styles.chatInput} label='Send a message'
            maxLength={500} floatingLabel={false} allowErrors={false}
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
