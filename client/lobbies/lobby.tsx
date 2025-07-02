import { Immutable } from 'immer'
import { List } from 'immutable'
import React from 'react'
import { WithTranslation, withTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { assertUnreachable } from '../../common/assert-unreachable'
import { gameTypeToLabel, isTeamType } from '../../common/games/game-type'
import {
  canAddObservers,
  canRemoveObservers,
  findSlotByUserId,
  hasOpposingSides,
  isUms,
  Lobby,
  Team,
} from '../../common/lobbies'
import { Slot, SlotType } from '../../common/lobbies/slot'
import { MapInfoJson } from '../../common/maps'
import { BwTurnRate } from '../../common/network'
import { RaceChar } from '../../common/races'
import { SelfUser } from '../../common/users/sb-user'
import { MapThumbnail } from '../maps/map-thumbnail'
import { FilledButton } from '../material/button'
import { Card } from '../material/card'
import { elevationPlus1 } from '../material/shadows'
import { Chat } from '../messaging/chat'
import { MessageComponentProps } from '../messaging/message-list'
import { SbMessage } from '../messaging/message-records'
import { headlineMedium, labelLarge, labelMedium, titleLarge } from '../styles/typography'
import { ClosedSlot } from './closed-slot'
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
import { LobbyLoadingState } from './lobby-reducer'
import { OpenSlot } from './open-slot'
import { PlayerSlot } from './player-slot'
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
  width: 100%;
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
  ${titleLarge};
  margin: 24px 0 0;
`

const StyledMapThumbnail = styled(MapThumbnail)`
  ${elevationPlus1};
  width: 256px;
  height: auto;
  margin-top: 8px;
`

const InfoItem = styled.div`
  margin: 8px 0 0;
  display: flex;
  align-items: baseline;
`

const InfoLabel = styled.div`
  ${labelMedium};
  color: var(--theme-on-surface-variant);
`

const InfoValue = styled.div`
  ${labelLarge};
  margin-left: 16px;
  flex-grow: 1;
`

const StartButton = styled(FilledButton)`
  margin-top: 24px;
`

const Countdown = styled.div`
  ${headlineMedium};
  margin: 16px 0;
`

function LobbyChatMessage({ message }: MessageComponentProps) {
  // Cast to just lobby messages so we can check for exhaustiveness, even though this won't
  // necessarily be a lobby message. This will be safe because we just return null in the default
  // case.
  const msg = message as SbMessage & { type: LobbyMessageType }
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
      msg satisfies never
      return null
  }
}

function turnRateToLabel(turnRate: BwTurnRate | 0 | undefined, t: WithTranslation['t']): string {
  if (turnRate === 0) {
    return t('lobbies.lobby.turnRateDynamic', 'DTR')
  } else if (!turnRate) {
    return t('lobbies.lobby.turnRateAuto', 'Auto')
  } else {
    return String(turnRate)
  }
}

interface LobbyProps {
  lobby: Lobby
  loadingState: LobbyLoadingState
  chat: List<SbMessage>
  user: ReadonlyDeep<SelfUser>
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
  onStartGame: () => void
}

class LobbyComponent extends React.Component<LobbyProps & WithTranslation> {
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

    const [, , mySlot] = findSlotByUserId(lobby, user.id)
    const isHost = mySlot && lobby.host.id === mySlot.id
    const canAddObsSlots = canAddObservers(lobby)
    const canRemoveObsSlots = canRemoveObservers(lobby)

    return team.slots
      .map((slot: Slot) => {
        const { type, userId, race, id, controlledBy } = slot
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
                userId={userId}
                race={race}
                isHost={isHost}
                canSetRace={slot === mySlot && !slot.hasForcedRace}
                canMakeObserver={canAddObsSlots && team.slots.size > 1}
                isSelf={slot === mySlot}
                onSetRace={(race: RaceChar) => onSetRace(id, race)}
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
                userId={userId}
                isHost={isHost}
                isObserver={true}
                canRemoveObserver={isObserver && canRemoveObsSlots}
                isSelf={slot === mySlot}
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
                userId={userId}
                race={race}
                isComputer={true}
                canSetRace={isHost}
                isHost={isHost}
                isSelf={false}
                onSetRace={(race: RaceChar) => onSetRace(id, race)}
                onCloseSlot={() => onCloseSlot(id)}
                onKickPlayer={() => onKickPlayer(id)}
              />
            )
          case SlotType.UmsComputer:
            return <PlayerSlot key={id} userId={userId} race={race} isComputer={true} />
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
                onSetRace={(race: RaceChar) => onSetRace(id, race)}
              />
            )
          default:
            return assertUnreachable(type)
        }
      })
      .toArray()
  }

  override render() {
    const { lobby, onLeaveLobbyClick, onSendChatMessage, onMapPreview, t } = this.props

    const isLobbyUms = isUms(lobby.gameType)
    const slots = []
    const obsSlots = []
    for (let teamIndex = 0; teamIndex < lobby.teams.size; teamIndex++) {
      const currentTeam = lobby.teams.get(teamIndex)!
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
          <StyledChat
            listProps={{ messages: this.props.chat, MessageComponent: LobbyChatMessage }}
            inputProps={{ onSendChatMessage }}
          />
        </Left>
        <Info>
          <FilledButton
            label={t('lobbies.lobby.leaveLobby', 'Leave lobby')}
            onClick={onLeaveLobbyClick}
          />
          <MapName>{(lobby.map as unknown as Immutable<MapInfoJson>).name}</MapName>
          <StyledMapThumbnail
            map={lobby.map as unknown as Immutable<MapInfoJson>}
            onPreview={onMapPreview}
          />
          <InfoItem>
            <InfoLabel as='span'>{t('lobbies.lobby.gameType', 'Game type')}</InfoLabel>
            <InfoValue as='span'>{gameTypeToLabel(lobby.gameType, t)}</InfoValue>
          </InfoItem>
          <InfoItem>
            <InfoLabel as='span'>{t('lobbies.lobby.turnRate', 'Turn rate')}</InfoLabel>
            <InfoValue as='span'>{turnRateToLabel(lobby.turnRate, t)}</InfoValue>
          </InfoItem>
          <InfoItem>
            <InfoLabel as='span'>{t('lobbies.lobby.unitLimit', 'Unit limit')}</InfoLabel>
            <InfoValue as='span'>
              {lobby.useLegacyLimits
                ? t('lobbies.lobby.unitLimitLegacy', 'Legacy')
                : t('lobbies.lobby.unitLimitExtended', 'Extended')}
            </InfoValue>
          </InfoItem>
          {this.renderCountdown()}
          {this.renderStartButton()}
        </Info>
      </ContentArea>
    )
  }

  renderCountdown() {
    const { loadingState } = this.props
    if (!loadingState.isCountingDown) {
      return null
    }

    return <Countdown>{loadingState.countdownTimer}</Countdown>
  }

  renderStartButton() {
    const { lobby, user, onStartGame, loadingState, t } = this.props
    if (!user || lobby.host.userId !== user.id) {
      return null
    }

    const isDisabled = loadingState.isCountingDown || !hasOpposingSides(lobby)
    return (
      <StartButton
        label={t('lobbies.lobby.startGame', 'Start game')}
        disabled={isDisabled}
        onClick={onStartGame}
      />
    )
  }
}

export default withTranslation()(LobbyComponent)
