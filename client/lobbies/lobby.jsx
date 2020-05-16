import React from 'react'
import PropTypes from 'prop-types'
import gameTypeToString from './game-type-to-string'
import {
  isUms,
  findSlotByName,
  hasOpposingSides,
  isTeamType,
  canRemoveObservers,
  canAddObservers,
} from '../../common/lobbies'
import styles from './view.css'

import Card from '../material/card.jsx'
import RaisedButton from '../material/raised-button.jsx'
import MessageInput from '../messaging/message-input.jsx'
import OpenSlot from './open-slot.jsx'
import ClosedSlot from './closed-slot.jsx'
import PlayerSlot from './player-slot.jsx'
import { ChatMessageLayout, ChatMessage } from '../messaging/message.jsx'
import { ScrollableContent } from '../material/scroll-bar.jsx'

class JoinMessage extends React.Component {
  static propTypes = {
    time: PropTypes.number.isRequired,
    name: PropTypes.string.isRequired,
  }

  render() {
    return (
      <ChatMessageLayout time={this.props.time} className={styles.chatSystemMessage}>
        <span>
          &gt;&gt; <span className={styles.chatImportant}>{this.props.name}</span> has joined the
          lobby
        </span>
      </ChatMessageLayout>
    )
  }
}

class LeaveMessage extends React.Component {
  static propTypes = {
    time: PropTypes.number.isRequired,
    name: PropTypes.string.isRequired,
  }

  render() {
    return (
      <ChatMessageLayout time={this.props.time} className={styles.chatSystemMessage}>
        <span>
          &lt;&lt; <span className={styles.chatImportant}>{this.props.name}</span> has left the
          lobby
        </span>
      </ChatMessageLayout>
    )
  }
}

class KickMessage extends React.Component {
  static propTypes = {
    time: PropTypes.number.isRequired,
    name: PropTypes.string.isRequired,
  }

  render() {
    return (
      <ChatMessageLayout time={this.props.time} className={styles.chatSystemMessage}>
        <span>
          &lt;&lt; <span className={styles.chatImportant}>{this.props.name}</span> has been kicked
          from the lobby
        </span>
      </ChatMessageLayout>
    )
  }
}

class BanMessage extends React.Component {
  static propTypes = {
    time: PropTypes.number.isRequired,
    name: PropTypes.string.isRequired,
  }

  render() {
    return (
      <ChatMessageLayout time={this.props.time} className={styles.chatSystemMessage}>
        <span>
          &lt;&lt; <span className={styles.chatImportant}>{this.props.name}</span> has been banned
          from the lobby
        </span>
      </ChatMessageLayout>
    )
  }
}

class SelfJoinMessage extends React.Component {
  static propTypes = {
    time: PropTypes.number.isRequired,
    lobby: PropTypes.string.isRequired,
    host: PropTypes.string.isRequired,
  }

  render() {
    return (
      <ChatMessageLayout time={this.props.time} className={styles.chatSystemMessage}>
        <span>
          You have joined <span className={styles.chatImportant}>{this.props.lobby}</span>. The host
          is <span className={styles.chatImportant}>{this.props.host}</span>.
        </span>
      </ChatMessageLayout>
    )
  }
}

class HostChangeMessage extends React.Component {
  static propTypes = {
    time: PropTypes.number.isRequired,
    name: PropTypes.string.isRequired,
  }

  render() {
    return (
      <ChatMessageLayout time={this.props.time} className={styles.chatSystemMessage}>
        <span>
          <span className={styles.chatImportant}>{this.props.name}</span> is now the host
        </span>
      </ChatMessageLayout>
    )
  }
}

class CountdownStartedMessage extends React.Component {
  static propTypes = {
    time: PropTypes.number.isRequired,
  }

  render() {
    return (
      <ChatMessageLayout time={this.props.time} className={styles.chatSystemMessage}>
        <span>The game countdown has begun</span>
      </ChatMessageLayout>
    )
  }
}

class CountdownTickMessage extends React.Component {
  static propTypes = {
    time: PropTypes.number.isRequired,
    timeLeft: PropTypes.number.isRequired,
  }

  render() {
    return (
      <ChatMessageLayout time={this.props.time} className={styles.chatSystemMessage}>
        <span>{this.props.timeLeft}&hellip;</span>
      </ChatMessageLayout>
    )
  }
}

class CountdownCanceledMessage extends React.Component {
  static propTypes = {
    time: PropTypes.number.isRequired,
  }

  render() {
    return (
      <ChatMessageLayout time={this.props.time} className={styles.chatSystemMessage}>
        <span>The game countdown has been canceled</span>
      </ChatMessageLayout>
    )
  }
}

class LoadingCanceledMessage extends React.Component {
  static propTypes = {
    time: PropTypes.number.isRequired,
  }

  // TODO(tec27): We really need to pass a reason back here
  render() {
    return (
      <ChatMessageLayout time={this.props.time} className={styles.chatSystemMessage}>
        <span>Game initialization has been canceled</span>
      </ChatMessageLayout>
    )
  }
}

class ChatList extends React.Component {
  static propTypes = {
    messages: PropTypes.object.isRequired,
  }

  _shouldAutoScroll = true
  _scrollbar = null
  _setScrollbarRef = elem => {
    this._scrollbar = elem
  }

  maybeScrollToBottom() {
    if (this._shouldAutoScroll) {
      this._scrollbar.scrollTop(this._scrollbar.getScrollHeight())
    }
  }

  componentDidMount() {
    this.maybeScrollToBottom()
  }

  shouldComponentUpdate(nextProps) {
    return nextProps.messages !== this.props.messages
  }

  componentWillUpdate() {
    const node = this._scrollbar
    this._shouldAutoScroll = node.getScrollTop() + node.getClientHeight() >= node.getScrollHeight()
  }

  componentDidUpdate() {
    this.maybeScrollToBottom()
  }

  renderMessage(msg) {
    const { id, type, time } = msg
    switch (type) {
      case 'message':
        return <ChatMessage key={id} user={msg.from} time={time} text={msg.text} />
      case 'join':
        return <JoinMessage key={id} time={time} name={msg.name} />
      case 'leave':
        return <LeaveMessage key={id} time={time} name={msg.name} />
      case 'kick':
        return <KickMessage key={id} time={time} name={msg.name} />
      case 'ban':
        return <BanMessage key={id} time={time} name={msg.name} />
      case 'selfJoin':
        return <SelfJoinMessage key={id} time={time} lobby={msg.lobby} host={msg.host} />
      case 'hostChange':
        return <HostChangeMessage key={id} time={time} name={msg.name} />
      case 'countdownStarted':
        return <CountdownStartedMessage key={id} time={time} />
      case 'countdownTick':
        return <CountdownTickMessage key={id} time={time} timeLeft={msg.timeLeft} />
      case 'countdownCanceled':
        return <CountdownCanceledMessage key={id} time={time} />
      case 'loadingCanceled':
        return <LoadingCanceledMessage key={id} time={time} />
      default:
        return null
    }
  }

  render() {
    return (
      <ScrollableContent
        ref={this._setScrollbarRef}
        className={styles.chat}
        viewClassName={styles.chatView}>
        {this.props.messages.map(msg => this.renderMessage(msg))}
      </ScrollableContent>
    )
  }
}

export default class Lobby extends React.Component {
  static propTypes = {
    lobby: PropTypes.object.isRequired,
    chat: PropTypes.object.isRequired,
    user: PropTypes.object,
    onLeaveLobbyClick: PropTypes.func,
    onSetRace: PropTypes.func,
    onAddComputer: PropTypes.func,
    onSendChatMessage: PropTypes.func,
    onSwitchSlot: PropTypes.func,
    onOpenSlot: PropTypes.func,
    onCloseSlot: PropTypes.func,
    onKickPlayer: PropTypes.func,
    onBanPlayer: PropTypes.func,
    onMakeObserver: PropTypes.func,
    onRemoveObserver: PropTypes.func,
  }

  getTeamSlots(team, isObserver, isLobbyUms) {
    const {
      lobby,
      user,
      onSetRace,
      onAddComputer,
      onSwitchSlot,
      onOpenSlot,
      onCloseSlot,
      onKickPlayer,
      onBanPlayer,
      onMakeObserver,
      onRemoveObserver,
    } = this.props

    const [, , mySlot] = findSlotByName(lobby, user.name)
    const isHost = mySlot && lobby.host.id === mySlot.id
    const canAddObsSlots = canAddObservers(lobby)
    const canRemoveObsSlots = canRemoveObservers(lobby)

    return team.slots
      .map(slot => {
        const { type, name, race, id, controlledBy } = slot
        switch (type) {
          case 'open':
            return (
              <OpenSlot
                key={id}
                race={race}
                isHost={isHost}
                isObserver={isObserver}
                canMakeObserver={!isObserver && canAddObsSlots && team.slots.size > 1}
                canRemoveObserver={isObserver && canRemoveObsSlots}
                onAddComputer={onAddComputer && !isLobbyUms ? () => onAddComputer(id) : undefined}
                onSwitchClick={onSwitchSlot ? () => onSwitchSlot(id) : undefined}
                onCloseSlot={onCloseSlot ? () => onCloseSlot(id) : undefined}
                onMakeObserver={onMakeObserver ? () => onMakeObserver(id) : undefined}
                onRemoveObserver={onRemoveObserver ? () => onRemoveObserver(id) : undefined}
              />
            )
          case 'closed':
            return (
              <ClosedSlot
                key={id}
                race={race}
                isHost={isHost}
                isObserver={isObserver}
                canMakeObserver={!isObserver && canAddObsSlots && team.slots.size > 1}
                canRemoveObserver={isObserver && canRemoveObsSlots}
                onAddComputer={onAddComputer && !isLobbyUms ? () => onAddComputer(id) : undefined}
                onOpenSlot={onOpenSlot ? () => onOpenSlot(id) : undefined}
                onMakeObserver={onMakeObserver ? () => onMakeObserver(id) : undefined}
                onRemoveObserver={onRemoveObserver ? () => onRemoveObserver(id) : undefined}
              />
            )
          case 'human':
            return (
              <PlayerSlot
                key={id}
                name={name}
                race={race}
                isHost={isHost}
                canSetRace={slot === mySlot && !slot.hasForcedRace}
                canMakeObserver={canAddObsSlots && team.slots.size > 1}
                hasSlotActions={slot !== mySlot}
                onSetRace={onSetRace ? race => onSetRace(id, race) : undefined}
                onOpenSlot={onOpenSlot ? () => onOpenSlot(id) : undefined}
                onCloseSlot={onCloseSlot ? () => onCloseSlot(id) : undefined}
                onKickPlayer={onKickPlayer ? () => onKickPlayer(id) : undefined}
                onBanPlayer={onBanPlayer ? () => onBanPlayer(id) : undefined}
                onMakeObserver={onMakeObserver ? () => onMakeObserver(id) : undefined}
              />
            )
          case 'observer':
            return (
              <PlayerSlot
                key={id}
                name={name}
                isHost={isHost}
                isObserver={true}
                canRemoveObserver={isObserver && canRemoveObsSlots}
                hasSlotActions={slot !== mySlot}
                onOpenSlot={onOpenSlot ? () => onOpenSlot(id) : undefined}
                onCloseSlot={onCloseSlot ? () => onCloseSlot(id) : undefined}
                onKickPlayer={onKickPlayer ? () => onKickPlayer(id) : undefined}
                onBanPlayer={onBanPlayer ? () => onBanPlayer(id) : undefined}
                onRemoveObserver={onRemoveObserver ? () => onRemoveObserver(id) : undefined}
              />
            )
          case 'computer':
            return (
              <PlayerSlot
                key={id}
                name={name}
                race={race}
                isComputer={true}
                canSetRace={isHost}
                isHost={isHost}
                hasSlotActions={true}
                onSetRace={onSetRace ? race => onSetRace(id, race) : undefined}
                onOpenSlot={onOpenSlot ? () => onOpenSlot(id) : undefined}
                onCloseSlot={onCloseSlot ? () => onCloseSlot(id) : undefined}
                onKickPlayer={onKickPlayer ? () => onKickPlayer(id) : undefined}
              />
            )
          case 'umsComputer':
            return <PlayerSlot key={id} name={name} race={race} isComputer={true} />
          case 'controlledOpen':
            return (
              <OpenSlot
                key={id}
                race={race}
                controlledOpen={true}
                canSetRace={mySlot && controlledBy === mySlot.id}
                isHost={isHost}
                onSetRace={onSetRace ? race => onSetRace(id, race) : undefined}
                onSwitchClick={onSwitchSlot ? () => onSwitchSlot(id) : undefined}
                onCloseSlot={onCloseSlot ? () => onCloseSlot(id) : undefined}
              />
            )
          case 'controlledClosed':
            return (
              <ClosedSlot
                key={id}
                race={race}
                controlledClosed={true}
                canSetRace={mySlot && controlledBy === mySlot.id}
                isHost={isHost}
                onOpenSlot={onOpenSlot ? () => onOpenSlot(id) : undefined}
              />
            )
          default:
            throw new Error('Unknown slot type: ' + type)
        }
      })
      .toArray()
  }

  render() {
    const { lobby, onLeaveLobbyClick, onSendChatMessage } = this.props

    const isLobbyUms = isUms(lobby.gameType)
    const slots = []
    const obsSlots = []
    for (let teamIndex = 0; teamIndex < lobby.teams.size; teamIndex++) {
      const currentTeam = lobby.teams.get(teamIndex)
      const isObserver = currentTeam.isObserver
      const displayTeamName =
        (isTeamType(lobby.gameType) || isLobbyUms || isObserver) && currentTeam.slots.size !== 0
      if (displayTeamName) {
        slots.push(
          <span key={'team' + teamIndex} className={styles.teamName}>
            {currentTeam.name}
          </span>,
        )
      }

      const currentSlots = this.getTeamSlots(currentTeam, isObserver, isLobbyUms)
      if (!isObserver) {
        slots.push(currentSlots)
      } else {
        obsSlots.push(currentSlots)
      }
    }

    return (
      <div className={styles.contentArea}>
        <div className={styles.left}>
          <Card className={styles.slots}>
            <div className={styles.regularSlots}>{slots}</div>
            <div className={styles.obsSlots}>{obsSlots}</div>
          </Card>
          <ChatList messages={this.props.chat} />
          <MessageInput className={styles.chatInput} onSend={onSendChatMessage} />
        </div>
        <div className={styles.info}>
          <RaisedButton label='Leave lobby' onClick={onLeaveLobbyClick} />
          <h3 className={styles.mapName}>{lobby.map.name}</h3>
          <img className={styles.mapThumbnail} src={lobby.map.imageUrl} />
          <div className={styles.infoItem}>
            <span className={styles.infoLabel}>Game type</span>
            <span className={styles.infoValue}>{gameTypeToString(lobby.gameType)}</span>
          </div>
          {this.renderCountdown()}
          {this.renderStartButton()}
        </div>
      </div>
    )
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
    if (!user || lobby.host.name !== user.name) {
      return null
    }

    const isDisabled = lobby.isCountingDown || !hasOpposingSides(lobby)
    return (
      <RaisedButton
        className={styles.startButton}
        color='primary'
        label='Start game'
        disabled={isDisabled}
        onClick={onStartGame}
      />
    )
  }
}
