import { List } from 'immutable'
import React from 'react'
import styled from 'styled-components'
import { gameTypeToLabel } from '../../common/games/configuration'
import {
  canAddObservers,
  canRemoveObservers,
  findSlotByName,
  hasOpposingSides,
  isTeamType,
  isUms,
} from '../../common/lobbies'
import { RaceChar } from '../../common/races'
import { SelfUserRecord } from '../auth/auth-records'
import FavoritedIcon from '../icons/material/baseline-star-24px.svg'
import UnfavoritedIcon from '../icons/material/baseline-star_border-24px.svg'
import PreviewIcon from '../icons/material/zoom_in-24px.svg'
import MapImage from '../maps/map-image'
import { IconButton, RaisedButton } from '../material/button'
import Card from '../material/card'
import { shadow1dp } from '../material/shadows'
import Chat from '../messaging/chat'
import { Message } from '../messaging/message-records'
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
import { LobbyInfo, Slot, Team } from './lobby-reducer'
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
`

const FavoriteActionIcon = styled(IconButton)`
  position: absolute;
  top: 4px;
  right: 4px;
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

function renderChatMessage(msg: Message) {
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
  lobby: ReturnType<typeof LobbyInfo>
  chat: List<Message>
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
  getTeamSlots(team: ReturnType<typeof Team>, isObserver: boolean, isLobbyUms: boolean) {
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
      .map((slot: ReturnType<typeof Slot>) => {
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
                onAddComputer={!isLobbyUms ? () => onAddComputer(id) : undefined}
                onSwitchClick={() => onSwitchSlot(id)}
                onCloseSlot={() => onCloseSlot(id)}
                onMakeObserver={() => onMakeObserver(id)}
                onRemoveObserver={() => onRemoveObserver(id)}
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
                onAddComputer={!isLobbyUms ? () => onAddComputer(id) : undefined}
                onOpenSlot={() => onOpenSlot(id)}
                onMakeObserver={() => onMakeObserver(id)}
                onRemoveObserver={() => onRemoveObserver(id)}
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
                onSetRace={(race: RaceChar) => onSetRace(id, race)}
                onOpenSlot={() => onOpenSlot(id)}
                onCloseSlot={() => onCloseSlot(id)}
                onKickPlayer={() => onKickPlayer(id)}
                onBanPlayer={() => onBanPlayer(id)}
                onMakeObserver={() => onMakeObserver(id)}
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
                onOpenSlot={() => onOpenSlot(id)}
                onCloseSlot={() => onCloseSlot(id)}
                onKickPlayer={() => onKickPlayer(id)}
                onBanPlayer={() => onBanPlayer(id)}
                onRemoveObserver={() => onRemoveObserver(id)}
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
                onSetRace={(race: RaceChar) => onSetRace(id, race)}
                onOpenSlot={() => onOpenSlot(id)}
                onCloseSlot={() => onCloseSlot(id)}
                onKickPlayer={() => onKickPlayer(id)}
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
                onSetRace={(race: RaceChar) => onSetRace(id, race)}
                onSwitchClick={() => onSwitchSlot(id)}
                onCloseSlot={() => onCloseSlot(id)}
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
                onOpenSlot={() => onOpenSlot(id)}
              />
            )
          default:
            throw new Error('Unknown slot type: ' + type)
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

    const isDisabled = lobby.isCountingDown || !hasOpposingSides(lobby)
    return (
      <StartButton color='primary' label='Start game' disabled={isDisabled} onClick={onStartGame} />
    )
  }
}
