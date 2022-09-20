import { Immutable } from 'immer'
import { List } from 'immutable'
import React from 'react'
import styled from 'styled-components'
import { assertUnreachable } from '../../common/assert-unreachable'
import { gameTypeToLabel, isTeamType } from '../../common/games/configuration'
import {
  canAddObservers,
  canRemoveObservers,
  findSlotByName,
  hasOpposingSides,
  isUms,
  Team,
} from '../../common/lobbies'
import { Slot, SlotType } from '../../common/lobbies/slot'
import { MapInfoJson } from '../../common/maps'
import { RaceChar } from '../../common/races'
import { SelfUserRecord } from '../auth/auth-records'
import { MapThumbnail } from '../maps/map-thumbnail'
import { RaisedButton } from '../material/button'
import Card from '../material/card'
import { shadow2dp } from '../material/shadows'
import { Chat } from '../messaging/chat'
import { SbMessage } from '../messaging/message-records'
import { colorTextSecondary } from '../styles/colors'
import { body1, headline4, headline6, subtitle1 } from '../styles/typography'
import ClosedSlot from './closed-slot'
import {
  BanLobbyPlayerMessage,
  JoinLobbyMessage,
  KickLobbyPlayerMessage,
  LeaveLobbyMessage,
  LobbyCountdownCanceledMessage,
  LobbyCountdownStartedMessage,
  LobbyCountdownTickMessage,
  LobbyHostChangeMessage,
  LobbyLoadingCanceledMessage,
  SelfJoinLobbyMessage,
} from './lobby-message-layout'
import { LobbyMessageType } from './lobby-message-records'
import { LobbyInfo } from './lobby-reducer'
import OpenSlot from './open-slot'
import PlayerSlot from './player-slot'
import { ObserverSlots, RegularSlots, TeamName } from './slot'

const StyledChat = styled(Chat)`
  flex-grow: 1;
  overflow: hidden;
  margin-top: 8px;
  padding-top: 0;
`

const SlotsCard = styled(Card)`
  width: 100%;
  flex-grow: 0;
  flex-shrink: 0;
  padding-top: 8px;
  padding-bottom: 8px;
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

const StyledMapThumbnail = styled(MapThumbnail)`
  ${shadow2dp};
  width: 256px;
  margin-top: 8px;
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

function renderChatMessage(msg: SbMessage) {
  switch (msg.type) {
    case LobbyMessageType.JoinLobby:
      return <JoinLobbyMessage key={msg.id} time={msg.time} userId={msg.userId} />
    case LobbyMessageType.LeaveLobby:
      return <LeaveLobbyMessage key={msg.id} time={msg.time} userId={msg.userId} />
    case LobbyMessageType.KickLobbyPlayer:
      return <KickLobbyPlayerMessage key={msg.id} time={msg.time} userId={msg.userId} />
    case LobbyMessageType.BanLobbyPlayer:
      return <BanLobbyPlayerMessage key={msg.id} time={msg.time} userId={msg.userId} />
    case LobbyMessageType.SelfJoinLobby:
      return (
        <SelfJoinLobbyMessage key={msg.id} time={msg.time} lobby={msg.lobby} hostId={msg.hostId} />
      )
    case LobbyMessageType.LobbyHostChange:
      return <LobbyHostChangeMessage key={msg.id} time={msg.time} userId={msg.userId} />
    case LobbyMessageType.LobbyCountdownStarted:
      return <LobbyCountdownStartedMessage key={msg.id} time={msg.time} />
    case LobbyMessageType.LobbyCountdownTick:
      return <LobbyCountdownTickMessage key={msg.id} time={msg.time} timeLeft={msg.timeLeft} />
    case LobbyMessageType.LobbyCountdownCanceled:
      return <LobbyCountdownCanceledMessage key={msg.id} time={msg.time} />
    case LobbyMessageType.LobbyLoadingCanceled:
      return <LobbyLoadingCanceledMessage key={msg.id} time={msg.time} />
    default:
      return null
  }
}

interface LobbyProps {
  lobby: LobbyInfo
  chat: List<SbMessage>
  user: SelfUserRecord
  isFavoritingMap: boolean
  onLeaveLobbyClick: () => void
  onSetRace: (slotId: string, race: RaceChar) => void
  onAddComputer: (slotId: string) => void
  onSendChatMessage: (msg: string) => void
  onSwitchSlot: (slotId: string) => void
  onOpenSlot: (slotId: string) => void
  onCloseSlot: (slotId: string) => void
  onKickPlayer: (slotId: string) => void
  onBanPlayer: (slotId: string) => void
  onMakeObserver: (slotId: string) => void
  onRemoveObserver: (slotId: string) => void
  onMapPreview: () => void
  onToggleFavoriteMap: () => void
  onStartGame: () => void
}

export default class Lobby extends React.Component<LobbyProps> {
  getTeamSlots(team: Team, isObserver: boolean, isLobbyUms: boolean) {
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

    const [, , mySlot] = findSlotByName(lobby as any, user.name)
    const isHost = mySlot && lobby.host.id === mySlot.id
    const canAddObsSlots = canAddObservers(lobby as any)
    const canRemoveObsSlots = canRemoveObservers(lobby as any)

    return team.slots
      .map((slot: Slot) => {
        const { type, name, race, id, controlledBy } = slot
        switch (type) {
          case SlotType.Open:
            return (
              <OpenSlot
                key={id}
                race={race}
                isHost={isHost}
                isObserver={isObserver}
                canMakeObserver={!isObserver && canAddObsSlots && team.slots.size > 1}
                canRemoveObserver={isObserver && canRemoveObsSlots}
                onAddComputer={!isLobbyUms ? () => onAddComputer(id) : undefined}
                onSwitchClick={() => onSwitchSlot(id)}
                onCloseSlot={() => onCloseSlot(id)}
                onMakeObserver={() => onMakeObserver(id)}
                onRemoveObserver={() => onRemoveObserver(id)}
              />
            )
          case SlotType.Closed:
            return (
              <ClosedSlot
                key={id}
                race={race}
                isHost={isHost}
                isObserver={isObserver}
                canMakeObserver={!isObserver && canAddObsSlots && team.slots.size > 1}
                canRemoveObserver={isObserver && canRemoveObsSlots}
                onAddComputer={!isLobbyUms ? () => onAddComputer(id) : undefined}
                onOpenSlot={() => onOpenSlot(id)}
                onMakeObserver={() => onMakeObserver(id)}
                onRemoveObserver={() => onRemoveObserver(id)}
              />
            )
          case SlotType.Human:
            return (
              <PlayerSlot
                key={id}
                name={name}
                race={race}
                isHost={isHost}
                canSetRace={slot === mySlot && !slot.hasForcedRace}
                canMakeObserver={canAddObsSlots && team.slots.size > 1}
                isSelf={slot === mySlot}
                onSetRace={(race: RaceChar) => onSetRace(id, race)}
                onOpenSlot={() => onOpenSlot(id)}
                onCloseSlot={() => onCloseSlot(id)}
                onKickPlayer={() => onKickPlayer(id)}
                onBanPlayer={() => onBanPlayer(id)}
                onMakeObserver={() => onMakeObserver(id)}
              />
            )
          case SlotType.Observer:
            return (
              <PlayerSlot
                key={id}
                name={name}
                isHost={isHost}
                isObserver={true}
                canRemoveObserver={isObserver && canRemoveObsSlots}
                isSelf={slot === mySlot}
                onOpenSlot={() => onOpenSlot(id)}
                onCloseSlot={() => onCloseSlot(id)}
                onKickPlayer={() => onKickPlayer(id)}
                onBanPlayer={() => onBanPlayer(id)}
                onRemoveObserver={() => onRemoveObserver(id)}
              />
            )
          case SlotType.Computer:
            return (
              <PlayerSlot
                key={id}
                name={name}
                race={race}
                isComputer={true}
                canSetRace={isHost}
                isHost={isHost}
                isSelf={false}
                onSetRace={(race: RaceChar) => onSetRace(id, race)}
                onOpenSlot={() => onOpenSlot(id)}
                onCloseSlot={() => onCloseSlot(id)}
                onKickPlayer={() => onKickPlayer(id)}
              />
            )
          case SlotType.UmsComputer:
            return <PlayerSlot key={id} name={name} race={race} isComputer={true} />
          case SlotType.ControlledOpen:
            return (
              <OpenSlot
                key={id}
                race={race}
                controlledOpen={true}
                canSetRace={mySlot && controlledBy === mySlot.id}
                isHost={isHost}
                onSetRace={(race: RaceChar) => onSetRace(id, race)}
                onSwitchClick={() => onSwitchSlot(id)}
                onCloseSlot={() => onCloseSlot(id)}
              />
            )
          case SlotType.ControlledClosed:
            return (
              <ClosedSlot
                key={id}
                race={race}
                controlledClosed={true}
                canSetRace={mySlot && controlledBy === mySlot.id}
                isHost={isHost}
                onOpenSlot={() => onOpenSlot(id)}
              />
            )
          default:
            return assertUnreachable(type)
        }
      })
      .toArray()
  }

  override render() {
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

    const listProps = { messages: this.props.chat, renderMessage: renderChatMessage }
    const inputProps = { onSendChatMessage }

    return (
      <ContentArea>
        <Left>
          <SlotsCard>
            <RegularSlots>{slots}</RegularSlots>
            <ObserverSlots>{obsSlots}</ObserverSlots>
          </SlotsCard>
          <StyledChat listProps={listProps} inputProps={inputProps} />
        </Left>
        <Info>
          <RaisedButton label='Leave lobby' onClick={onLeaveLobbyClick} />
          <MapName>{(lobby.map as unknown as Immutable<MapInfoJson>).name}</MapName>
          <StyledMapThumbnail
            map={lobby.map as unknown as Immutable<MapInfoJson>}
            onPreview={onMapPreview}
            onToggleFavorite={onToggleFavoriteMap}
            isFavoriting={isFavoritingMap}
          />
          <InfoItem>
            <InfoLabel as='span'>Game type</InfoLabel>
            <InfoValue as='span'>{gameTypeToLabel(lobby.gameType)}</InfoValue>
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

    const isDisabled = lobby.isCountingDown || !hasOpposingSides(lobby as any)
    return (
      <StartButton color='primary' label='Start game' disabled={isDisabled} onClick={onStartGame} />
    )
  }
}
