import React from 'react'
import PropTypes from 'prop-types'
import styled from 'styled-components'
import gameTypeToString from './game-type-to-string'
import {
  isUms,
  findSlotByName,
  hasOpposingSides,
  isTeamType,
  canRemoveObservers,
  canAddObservers,
} from '../../common/lobbies'

import Card from '../material/card'
import IconButton from '../material/icon-button'
import { Label } from '../material/button'
import RaisedButton from '../material/raised-button'
import MapImage from '../maps/map-image'
import MessageInput from '../messaging/message-input'
import { ScrollableContent } from '../material/scroll-bar'
import { ChatMessageLayout, TextMessageDisplay } from '../messaging/message'
import OpenSlot from './open-slot'
import ClosedSlot from './closed-slot'
import PlayerSlot from './player-slot'
import { ObserverSlots, RegularSlots, TeamName } from './slot'

import FavoritedIcon from '../icons/material/baseline-star-24px.svg'
import PreviewIcon from '../icons/material/zoom_in-24px.svg'
import UnfavoritedIcon from '../icons/material/baseline-star_border-24px.svg'

import { blue100, blue200, colorTextSecondary } from '../styles/colors'
import { body1, body2, headline6, headline4, subtitle1 } from '../styles/typography'
import { shadow1dp } from '../material/shadows'

const ChatSystemMessage = styled(ChatMessageLayout)`
  color: ${blue200};
`

const ChatImportant = styled.span`
  ${body2};
  line-height: inherit;
  color: ${blue100};
`

class JoinMessage extends React.Component {
  static propTypes = {
    time: PropTypes.number.isRequired,
    name: PropTypes.string.isRequired,
  }

  render() {
    return (
      <ChatSystemMessage time={this.props.time}>
        <span>
          &gt;&gt; <ChatImportant>{this.props.name}</ChatImportant> has joined the lobby
        </span>
      </ChatSystemMessage>
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
      <ChatSystemMessage time={this.props.time}>
        <span>
          &lt;&lt; <ChatImportant>{this.props.name}</ChatImportant> has left the lobby
        </span>
      </ChatSystemMessage>
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
      <ChatSystemMessage time={this.props.time}>
        <span>
          &lt;&lt; <ChatImportant>{this.props.name}</ChatImportant> has been kicked from the lobby
        </span>
      </ChatSystemMessage>
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
      <ChatSystemMessage time={this.props.time}>
        <span>
          &lt;&lt; <ChatImportant>{this.props.name}</ChatImportant> has been banned from the lobby
        </span>
      </ChatSystemMessage>
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
      <ChatSystemMessage time={this.props.time}>
        <span>
          You have joined <ChatImportant>{this.props.lobby}</ChatImportant>. The host is{' '}
          <ChatImportant>{this.props.host}</ChatImportant>.
        </span>
      </ChatSystemMessage>
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
      <ChatSystemMessage time={this.props.time}>
        <span>
          <ChatImportant>{this.props.name}</ChatImportant> is now the host
        </span>
      </ChatSystemMessage>
    )
  }
}

class CountdownStartedMessage extends React.Component {
  static propTypes = {
    time: PropTypes.number.isRequired,
  }

  render() {
    return (
      <ChatSystemMessage time={this.props.time}>
        <span>The game countdown has begun</span>
      </ChatSystemMessage>
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
      <ChatSystemMessage time={this.props.time}>
        <span>{this.props.timeLeft}&hellip;</span>
      </ChatSystemMessage>
    )
  }
}

class CountdownCanceledMessage extends React.Component {
  static propTypes = {
    time: PropTypes.number.isRequired,
  }

  render() {
    return (
      <ChatSystemMessage time={this.props.time}>
        <span>The game countdown has been canceled</span>
      </ChatSystemMessage>
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
      <ChatSystemMessage time={this.props.time}>
        <span>Game initialization has been canceled</span>
      </ChatSystemMessage>
    )
  }
}

const StyledScrollableChat = styled(ScrollableContent)`
  margin-top: 8px;
  user-select: contain;

  & * {
    user-select: text;
  }
`

const ChatView = styled.div`
  padding: 8px 8px 0px;
`

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

  getSnapshotBeforeUpdate() {
    const node = this._scrollbar
    this._shouldAutoScroll = node.getScrollTop() + node.getClientHeight() >= node.getScrollHeight()
    return null
  }

  componentDidUpdate() {
    this.maybeScrollToBottom()
  }

  renderMessage(msg) {
    const { id, type, time } = msg
    switch (type) {
      case 'message':
        return <TextMessageDisplay key={id} user={msg.from} time={time} text={msg.text} />
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
      <StyledScrollableChat ref={this._setScrollbarRef} viewElement={<ChatView />}>
        {this.props.messages.map(msg => this.renderMessage(msg))}
      </StyledScrollableChat>
    )
  }
}

const SlotsCard = styled(Card)`
  width: 100%;
  flex-grow: 0;
  flex-shrink: 0;
  padding-top: 8px;
  padding-bottom: 8px;
`

const StyledMessageInput = styled(MessageInput)`
  flex-shrink: 0;
  margin: 8px 0;
  padding: 0 16px;
`

const ContentArea = styled.div`
  max-width: 1140px;
  height: 100%;
  padding: 0 16px;
  margin: 0 auto;
  border-left: var(--pixel-shove-x, 0px) solid transparent;

  display: flex;
  justify-content: space-between;
`

const Left = styled.div`
  min-width: 320px;
  min-height: 100%;
  max-height: 100%;
  padding-top: 16px;

  display: flex;
  flex-direction: column;
  flex-grow: 1;
`

const Info = styled.div`
  width: 256px;
  margin: 16px 0 16px 40px;
  flex-grow: 0;
  flex-shrink: 0;
`

const MapName = styled.div`
  ${headline6};
  margin: 24px 0 0;
`

const MapImageContainer = styled.div`
  ${shadow1dp};
  position: relative;
  width: 256px;
  border-radius: 2px;
  margin-top: 8px;
  overflow: hidden;
`

const MapPreviewIcon = styled(IconButton)`
  position: absolute;
  top: 4px;
  left: 4px;

  & ${Label} {
    color: ${colorTextSecondary};
  }
`

const FavoriteActionIcon = styled(IconButton)`
  position: absolute;
  top: 4px;
  right: 4px;

  & ${Label} {
    color: ${colorTextSecondary};
  }
`

const InfoItem = styled.div`
  margin: 8px 0 0;
  display: flex;
  align-items: center;
`

const InfoLabel = styled.div`
  ${body1};
  color: ${colorTextSecondary};
`

const InfoValue = styled.div`
  ${subtitle1};
  margin-left: 16px;
  flex-grow: 1;
`

const StartButton = styled(RaisedButton)`
  margin-top: 24px;
`

const Countdown = styled.div`
  ${headline4};
  margin: 16px 0;
`

export default class Lobby extends React.Component {
  static propTypes = {
    lobby: PropTypes.object.isRequired,
    chat: PropTypes.object.isRequired,
    user: PropTypes.object,
    isFavoritingMap: PropTypes.bool,
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
    onMapPreview: PropTypes.func,
    onToggleFavoriteMap: PropTypes.func,
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
    const {
      lobby,
      isFavoritingMap,
      onLeaveLobbyClick,
      onSendChatMessage,
      onMapPreview,
      onToggleFavoriteMap,
    } = this.props

    const isLobbyUms = isUms(lobby.gameType)
    const slots = []
    const obsSlots = []
    for (let teamIndex = 0; teamIndex < lobby.teams.size; teamIndex++) {
      const currentTeam = lobby.teams.get(teamIndex)
      const isObserver = currentTeam.isObserver
      const displayTeamName =
        (isTeamType(lobby.gameType) || isLobbyUms || isObserver) && currentTeam.slots.size !== 0
      if (displayTeamName) {
        slots.push(<TeamName key={'team' + teamIndex}>{currentTeam.name}</TeamName>)
      }

      const currentSlots = this.getTeamSlots(currentTeam, isObserver, isLobbyUms)
      if (!isObserver) {
        slots.push(currentSlots)
      } else {
        obsSlots.push(currentSlots)
      }
    }

    return (
      <ContentArea>
        <Left>
          <SlotsCard>
            <RegularSlots>{slots}</RegularSlots>
            <ObserverSlots>{obsSlots}</ObserverSlots>
          </SlotsCard>
          <ChatList messages={this.props.chat} />
          <StyledMessageInput onSend={onSendChatMessage} />
        </Left>
        <Info>
          <RaisedButton label='Leave lobby' onClick={onLeaveLobbyClick} />
          <MapName>{lobby.map.name}</MapName>
          <MapImageContainer>
            <MapImage map={lobby.map} />
            <MapPreviewIcon
              icon={<PreviewIcon />}
              title={'Show map preview'}
              onClick={onMapPreview}
            />
            <FavoriteActionIcon
              disabled={isFavoritingMap}
              icon={lobby.map.isFavorited ? <FavoritedIcon /> : <UnfavoritedIcon />}
              title={lobby.map.isFavorited ? 'Remove from favorites' : 'Add to favorites'}
              onClick={onToggleFavoriteMap}
            />
          </MapImageContainer>
          <InfoItem>
            <InfoLabel as='span'>Game type</InfoLabel>
            <InfoValue as='span'>{gameTypeToString(lobby.gameType)}</InfoValue>
          </InfoItem>
          {this.renderCountdown()}
          {this.renderStartButton()}
        </Info>
      </ContentArea>
    )
  }

  renderCountdown() {
    const { lobby } = this.props
    if (!lobby.isCountingDown) {
      return null
    }

    return <Countdown>{lobby.countdownTimer}</Countdown>
  }

  renderStartButton() {
    const { lobby, user, onStartGame } = this.props
    if (!user || lobby.host.name !== user.name) {
      return null
    }

    const isDisabled = lobby.isCountingDown || !hasOpposingSides(lobby)
    return (
      <StartButton color='primary' label='Start game' disabled={isDisabled} onClick={onStartGame} />
    )
  }
}
