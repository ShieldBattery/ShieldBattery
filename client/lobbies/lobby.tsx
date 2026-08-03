import { Transition } from 'motion/react'
import * as m from 'motion/react-m'
import React, { useState } from 'react'
import { useTranslation, WithTranslation, withTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { assertUnreachable } from '../../common/assert-unreachable'
import { GameType, gameTypeToLabel, isTeamType } from '../../common/games/game-type'
import {
  canAddObservers,
  canRemoveObservers,
  findSlotByUserId,
  hasObservers,
  hasOpposingSides,
  isUms,
  Lobby,
  slotCount,
  Team,
} from '../../common/lobbies'
import { urlForLobby } from '../../common/lobbies/lobby-url'
import { Slot, SlotType } from '../../common/lobbies/slot'
import { RaceChar } from '../../common/races'
import { SelfUserJson } from '../../common/users/sb-user'
import { SbUserId } from '../../common/users/sb-user-id'
import { ConnectedAvatar } from '../avatars/avatar'
import { MaterialIcon } from '../icons/material/material-icon'
import { ReduxMapThumbnail } from '../maps/map-thumbnail'
import { FilledButton, TextButton } from '../material/button'
import { Card } from '../material/card'
import { elevationPlus1 } from '../material/shadows'
import { Chat } from '../messaging/chat'
import { MessageComponentProps } from '../messaging/message-list'
import { SbMessage } from '../messaging/message-records'
import { useLinkCopier } from '../navigation/copy-link-button'
import { getServerOrigin } from '../network/server-url'
import { useAppSelector } from '../redux-hooks'
import { headlineMedium, labelLarge, labelMedium } from '../styles/typography'
import { ConnectedUsername } from '../users/connected-username'
import { ClosedSlot } from './closed-slot'
import { LobbyUserMenu } from './lobby-menu-items'
import {
  BanLobbyPlayerMessage,
  BenchJoinMessage,
  JoinLobbyMessage,
  KickLobbyPlayerMessage,
  LeaveLobbyMessage,
  LobbyCountdownCanceledMessage,
  LobbyCountdownStartedMessage,
  LobbyCountdownTickMessage,
  LobbyHostChangeMessage,
  LobbyLoadingCanceledMessage,
  SelfJoinLobbyMessage,
  SettingsChangeMessage,
} from './lobby-message-layout'
import { LobbyMessageType } from './lobby-message-records'
import { LobbyLoadingState } from './lobby-reducer'
import { OpenSlot } from './open-slot'
import { PlayerSlot } from './player-slot'
import {
  ObserverSlots,
  RegularSlots,
  SlotLeft,
  SlotName,
  SlotProfile,
  SlotRight,
  Slot as SlotRow,
  TeamName,
} from './slot'
import { SlotActions } from './slot-actions'

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

const InfoActions = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const StyledMapThumbnail = styled(ReduxMapThumbnail)`
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

/**
 * A button that copies a shareable link to this lobby. The lobby's id is what actually grants
 * access, so this is the only way to invite someone into a lobby that isn't publicly listed.
 */
function CopyInviteLinkButton({ lobby }: { lobby: Lobby }) {
  const { t } = useTranslation()
  const [copied, copyLink] = useLinkCopier(
    () => getServerOrigin() + urlForLobby(lobby.id, lobby.name),
  )

  return (
    <TextButton
      label={
        copied
          ? t('lobbies.lobby.copiedInviteLink', 'Copied!')
          : t('lobbies.lobby.copyInviteLink', 'Copy invite link')
      }
      iconStart={<MaterialIcon icon='link' />}
      onClick={copyLink}
      testName='copy-invite-link-button'
    />
  )
}

/**
 * A button that opens the host-only lobby settings dialog. Hidden entirely for non-hosts, mirroring
 * the visibility check `renderStartButton` uses for the start-game button.
 */
function LobbySettingsButton({
  lobby,
  user,
  onOpenLobbySettings,
}: {
  lobby: Lobby
  user: ReadonlyDeep<SelfUserJson>
  onOpenLobbySettings: () => void
}) {
  const { t } = useTranslation()
  if (lobby.host.userId !== user.id) {
    return null
  }

  return (
    <TextButton
      label={t('lobbies.lobby.settings', 'Lobby settings')}
      iconStart={<MaterialIcon icon='settings' />}
      onClick={onOpenLobbySettings}
      testName='lobby-settings-button'
    />
  )
}

const highlightTransition: Transition = {
  backgroundColor: { type: 'tween', duration: 0.9, ease: 'easeOut' },
}

const HighlightSpan = styled(m.span)`
  display: inline-block;
  border-radius: 4px;
`

const HighlightDiv = styled(m.div)`
  border-radius: 4px;
`

const highlightInitial = { backgroundColor: 'rgba(255, 196, 0, 0.45)' } // ~amber60
const highlightAnimate = { backgroundColor: 'rgba(255, 196, 0, 0)' }

/**
 * Returns a key that changes every time `value` changes (but not on first call) — used to force a
 * `motion` component to remount and replay its `initial` -> `animate` transition on every change.
 *
 * Follows React's documented "adjusting state when a prop changes" pattern: the state update below
 * happens directly in the render body (not an effect), so React reruns the component immediately
 * with the new state before anything is painted, rather than committing a stale frame first.
 */
function useHighlightRemountKey(value: string | number): number {
  const [state, setState] = useState({ value, key: 0 })
  if (state.value !== value) {
    setState({ value, key: state.key + 1 })
  }
  return state.key
}

/**
 * Wraps an inline value so its background briefly flashes an accent color whenever `value` changes
 * (but not on the wrapper's first mount) — used to call out lobby settings the host just changed.
 */
function SettingHighlight({
  value,
  children,
}: {
  value: string | number
  children: React.ReactNode
}) {
  const remountKey = useHighlightRemountKey(value)
  return (
    <HighlightSpan
      key={remountKey}
      initial={remountKey > 0 ? highlightInitial : false}
      animate={highlightAnimate}
      transition={highlightTransition}>
      {children}
    </HighlightSpan>
  )
}

/** Block-level counterpart to {@link SettingHighlight}, for wrapping non-inline content. */
function SettingHighlightBlock({
  value,
  children,
}: {
  value: string | number
  children: React.ReactNode
}) {
  const remountKey = useHighlightRemountKey(value)
  return (
    <HighlightDiv
      key={remountKey}
      initial={remountKey > 0 ? highlightInitial : false}
      animate={highlightAnimate}
      transition={highlightTransition}>
      {children}
    </HighlightDiv>
  )
}

/** A label for a lobby's current game sub-type, e.g. "2 vs 6" or "3 teams". */
function gameSubTypeLabel(lobby: Lobby, t: WithTranslation['t']): string | undefined {
  if (!isTeamType(lobby.gameType)) {
    return undefined
  }

  if (lobby.gameType === GameType.TopVsBottom) {
    const topSlots = lobby.gameSubType
    const bottomSlots = slotCount(lobby) - topSlots
    return t('lobbies.createLobby.gameSubTypeOptionTvB', {
      defaultValue: '{{topSlots}} vs {{bottomSlots}}',
      topSlots,
      bottomSlots,
    })
  }

  return t('lobbies.createLobby.gameSubTypeOption', {
    defaultValue: '{{numTeams}} teams',
    numTeams: lobby.gameSubType,
  })
}

const BenchAvatar = styled(ConnectedAvatar)`
  width: 24px;
  height: 24px;
  margin-left: 1px; /* To align with bordered empty slot avatar area */
  margin-right: 16px;

  flex-grow: 0;
  flex-shrink: 0;
`

const BenchSlots = styled(RegularSlots)`
  margin-top: 8px;
`

/** A row for a lobby member on the bench: just their name and (if host) a kick/ban menu. */
function BenchRow({
  userId,
  isHost,
  isSelf,
  onKickPlayer,
  onBanPlayer,
}: {
  userId: SbUserId
  isHost?: boolean
  isSelf?: boolean
  onKickPlayer?: () => void
  onBanPlayer?: () => void
}) {
  const { t } = useTranslation()
  const user = useAppSelector(s => s.users.byId.get(userId))

  const slotActions: [string, () => void][] = []
  if (isHost && !isSelf) {
    slotActions.push([
      user
        ? t('lobbies.slots.kickPlayer', {
            defaultValue: 'Kick {{user}}',
            user: user.name,
          })
        : t('lobbies.slots.kickUnnamedPlayer', 'Kick player'),
      onKickPlayer!,
    ])
    slotActions.push([
      user
        ? t('lobbies.slots.banPlayer', {
            defaultValue: 'Ban {{user}}',
            user: user.name,
          })
        : t('lobbies.slots.banUnnamedPlayer', 'Ban player'),
      onBanPlayer!,
    ])
  }

  return (
    <SlotRow data-testid='lobby-bench-row'>
      <SlotLeft>
        <SlotProfile>
          <BenchAvatar userId={userId} />
          <SlotName as='span'>
            <ConnectedUsername userId={userId} UserMenu={LobbyUserMenu} />
          </SlotName>
        </SlotProfile>
        {slotActions.length > 0 ? <SlotActions slotActions={slotActions} /> : <div />}
      </SlotLeft>
      <SlotRight />
    </SlotRow>
  )
}

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
      return (
        <LobbyLoadingCanceledMessage key={msg.id} time={msg.time} usersAtFault={msg.usersAtFault} />
      )
    case LobbyMessageType.LobbySettingsChange:
      return (
        <SettingsChangeMessage key={msg.id} time={msg.time} changedSettings={msg.changedSettings} />
      )
    case LobbyMessageType.LobbyBenchJoin:
      return <BenchJoinMessage key={msg.id} time={msg.time} userId={msg.userId} />
    default:
      msg satisfies never
      return null
  }
}

export interface LobbyProps {
  lobby: Lobby
  loadingState: LobbyLoadingState
  chat: SbMessage[]
  user: ReadonlyDeep<SelfUserJson>
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
  onMoveSlot: (slotId: string) => void
  onMapPreview: () => void
  onStartGame: () => void
  onOpenLobbySettings: () => void
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
      onMoveSlot,
    } = this.props

    const [, , mySlot] = findSlotByUserId(lobby, user.id)
    const isHost = mySlot && lobby.host.id === mySlot.id
    const canAddObsSlots = canAddObservers(lobby)
    const canRemoveObsSlots = canRemoveObservers(lobby)

    return team.slots.map((slot: Slot) => {
      const { type, userId, race, id, controlledBy } = slot
      switch (type) {
        case SlotType.Open:
          return (
            <OpenSlot
              key={id}
              race={race}
              isHost={isHost}
              isObserver={isObserver}
              onAddComputer={!isLobbyUms ? () => onAddComputer(id) : undefined}
              onSwitchClick={() => onSwitchSlot(id)}
              onCloseSlot={() => onCloseSlot(id)}
            />
          )
        case SlotType.Closed:
          return (
            <ClosedSlot
              key={id}
              race={race}
              isHost={isHost}
              isObserver={isObserver}
              onAddComputer={!isLobbyUms ? () => onAddComputer(id) : undefined}
              onOpenSlot={() => onOpenSlot(id)}
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
              canMakeObserver={canAddObsSlots}
              isSelf={slot === mySlot}
              onSetRace={(race: RaceChar) => onSetRace(id, race)}
              onCloseSlot={() => onCloseSlot(id)}
              onKickPlayer={() => onKickPlayer(id)}
              onBanPlayer={() => onBanPlayer(id)}
              onMakeObserver={() => onMakeObserver(id)}
              onMoveSlot={() => onMoveSlot(id)}
            />
          )
        case SlotType.Observer:
          return (
            <PlayerSlot
              key={id}
              userId={userId}
              isHost={isHost}
              isObserver={true}
              canRemoveObserver={canRemoveObsSlots}
              isSelf={slot === mySlot}
              onCloseSlot={() => onCloseSlot(id)}
              onKickPlayer={() => onKickPlayer(id)}
              onBanPlayer={() => onBanPlayer(id)}
              onRemoveObserver={() => onRemoveObserver(id)}
              onMoveSlot={() => onMoveSlot(id)}
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
              onMoveSlot={() => onMoveSlot(id)}
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
  }

  override render() {
    const {
      lobby,
      user,
      onLeaveLobbyClick,
      onSendChatMessage,
      onOpenLobbySettings,
      onKickPlayer,
      onBanPlayer,
      t,
    } = this.props

    const [, , mySlot] = findSlotByUserId(lobby, user.id)
    const isHost = mySlot && lobby.host.id === mySlot.id
    const isLobbyUms = isUms(lobby.gameType)
    const slots = []
    const obsSlots = []
    for (let teamIndex = 0; teamIndex < lobby.teams.length; teamIndex++) {
      const currentTeam = lobby.teams[teamIndex]
      const isObserver = currentTeam.isObserver
      const displayTeamName =
        (isTeamType(lobby.gameType) || isLobbyUms || isObserver) && currentTeam.slots.length !== 0
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

    const subTypeLabel = gameSubTypeLabel(lobby, t)
    const observersAllowed = hasObservers(lobby)

    return (
      <ContentArea>
        <Left>
          <SlotsCard>
            <RegularSlots>{slots}</RegularSlots>
            <ObserverSlots>{obsSlots}</ObserverSlots>
            {lobby.bench.length > 0 ? (
              <BenchSlots>
                <TeamName>{t('lobbies.lobby.benchTeamName', 'Waiting for a seat')}</TeamName>
                {lobby.bench.map(benched => (
                  <BenchRow
                    key={benched.userId}
                    userId={benched.userId}
                    isHost={isHost}
                    isSelf={benched.userId === user.id}
                    onKickPlayer={() => onKickPlayer(String(benched.userId))}
                    onBanPlayer={() => onBanPlayer(String(benched.userId))}
                  />
                ))}
              </BenchSlots>
            ) : null}
          </SlotsCard>
          <StyledChat
            listProps={{ messages: this.props.chat, MessageComponent: LobbyChatMessage }}
            inputProps={{ onSendChatMessage }}
            UserMenu={LobbyUserMenu}
          />
        </Left>
        <Info>
          <InfoActions>
            <FilledButton
              label={t('lobbies.lobby.leaveLobby', 'Leave lobby')}
              onClick={onLeaveLobbyClick}
              testName='leave-lobby-button'
            />
            <CopyInviteLinkButton lobby={lobby} />
            <LobbySettingsButton
              lobby={lobby}
              user={user}
              onOpenLobbySettings={onOpenLobbySettings}
            />
          </InfoActions>
          <SettingHighlightBlock value={lobby.map!.id}>
            <StyledMapThumbnail mapId={lobby.map!.id} showInfoLayer />
          </SettingHighlightBlock>
          <InfoItem>
            <InfoLabel as='span'>{t('lobbies.lobby.gameType', 'Game type')}</InfoLabel>
            <InfoValue as='span'>
              <SettingHighlight value={lobby.gameType}>
                {gameTypeToLabel(lobby.gameType, t)}
              </SettingHighlight>
            </InfoValue>
          </InfoItem>
          {subTypeLabel !== undefined ? (
            <InfoItem>
              <InfoLabel as='span'>{t('lobbies.lobby.gameSubType', 'Teams')}</InfoLabel>
              <InfoValue as='span'>
                <SettingHighlight value={lobby.gameSubType}>{subTypeLabel}</SettingHighlight>
              </InfoValue>
            </InfoItem>
          ) : null}
          <InfoItem>
            <InfoLabel as='span'>{t('lobbies.lobby.visibility', 'Visibility')}</InfoLabel>
            <InfoValue as='span'>
              {lobby.visibility === 'unlisted'
                ? t('lobbies.lobby.visibilityUnlisted', 'Unlisted')
                : t('lobbies.lobby.visibilityListed', 'Public')}
            </InfoValue>
          </InfoItem>
          <InfoItem>
            <InfoLabel as='span'>{t('lobbies.lobby.unitLimit', 'Unit limit')}</InfoLabel>
            <InfoValue as='span'>
              <SettingHighlight value={String(lobby.useLegacyLimits)}>
                {lobby.useLegacyLimits
                  ? t('lobbies.lobby.unitLimitLegacy', 'Legacy')
                  : t('lobbies.lobby.unitLimitExtended', 'Extended')}
              </SettingHighlight>
            </InfoValue>
          </InfoItem>
          <InfoItem>
            <InfoLabel as='span'>{t('lobbies.lobby.observers', 'Observers')}</InfoLabel>
            <InfoValue as='span'>
              <SettingHighlight value={String(observersAllowed)}>
                {observersAllowed
                  ? t('lobbies.lobby.observersAllowed', 'Allowed')
                  : t('lobbies.lobby.observersDisabled', 'Disabled')}
              </SettingHighlight>
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
        testName='start-game-button'
      />
    )
  }
}

export default withTranslation()(LobbyComponent)
