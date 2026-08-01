import { useTranslation } from 'react-i18next'
import styled, { css } from 'styled-components'
import { RaceChar } from '../../common/races'
import { SbUserId } from '../../common/users/sb-user-id'
import { ConnectedAvatar } from '../avatars/avatar'
import ComputerAvatar from '../avatars/computer-avatar'
import { useAppSelector } from '../redux-hooks'
import { labelSmall } from '../styles/typography'
import { ConnectedUsername } from '../users/connected-username'
import { LobbyUserMenu } from './lobby-menu-items'
import { RacePicker } from './race-picker'
import { SelectedRace } from './selected-race'
import { Slot, SlotLeft, SlotName, SlotProfile, SlotRight } from './slot'
import { SlotActions } from './slot-actions'

const avatarStyles = css`
  width: 24px;
  height: 24px;
  margin-left: 1px; /* To align with bordered empty slot avatar area */
  margin-right: 16px;

  flex-grow: 0;
  flex-shrink: 0;
`

const StyledComputerAvatar = styled(ComputerAvatar)`
  ${avatarStyles};
`

const PlayerAvatarContainer = styled.div`
  position: relative;
  width: 24px;
  height: 24px;
  margin-left: 1px; /* To align with bordered empty slot avatar area */
  margin-right: 16px;

  flex-grow: 0;
  flex-shrink: 0;
`

const PlayerAvatar = styled(ConnectedAvatar)`
  width: 24px;
  height: 24px;
`

const InGameSlot = styled(Slot)<{ $inGame?: boolean }>`
  ${props => (props.$inGame ? 'opacity: 0.6;' : '')}
`

const InGameTag = styled.span`
  ${labelSmall};
  flex-shrink: 0;
  margin-right: 8px;
  color: var(--theme-on-surface-variant);
`

export interface PlayerSlotProps {
  userId?: SbUserId
  isComputer?: boolean
  isHost?: boolean
  canMakeObserver?: boolean
  canRemoveObserver?: boolean
  isSelf?: boolean
  isObserver?: boolean
  canSetRace?: boolean
  race?: RaceChar
  /** Whether this slot's occupant is still in the lobby's currently-running game. */
  inGame?: boolean
  onSetRace?: (race: RaceChar) => void
  onCloseSlot?: () => void
  onKickPlayer?: () => void
  onBanPlayer?: () => void
  onMakeObserver?: () => void
  onRemoveObserver?: () => void
  onMoveSlot?: () => void
}

export function PlayerSlot({
  userId,
  isComputer,
  isHost,
  canMakeObserver,
  canRemoveObserver,
  isSelf,
  isObserver,
  canSetRace,
  race = 'r',
  inGame,
  onSetRace,
  onCloseSlot,
  onKickPlayer,
  onBanPlayer,
  onMakeObserver,
  onRemoveObserver,
  onMoveSlot,
}: PlayerSlotProps) {
  const { t } = useTranslation()
  const user = useAppSelector(s => userId && s.users.byId.get(userId))

  const avatar = isComputer ? (
    <StyledComputerAvatar />
  ) : (
    <PlayerAvatarContainer>
      <PlayerAvatar userId={userId!} />
    </PlayerAvatarContainer>
  )
  const displayName = isComputer ? (
    t('game.playerName.computer', 'Computer')
  ) : (
    <ConnectedUsername userId={userId!} UserMenu={LobbyUserMenu} />
  )

  const slotActions: [string, (() => void) | undefined][] = []
  if (isHost) {
    if (!isSelf) {
      slotActions.push([t('lobbies.slots.closeSlot', 'Close slot'), onCloseSlot])
      if (!isComputer) {
        slotActions.push([
          user
            ? t('lobbies.slots.kickPlayer', {
                defaultValue: 'Kick {{user}}',
                user: user.name,
              })
            : t('lobbies.slots.kickUnnamedPlayer', 'Kick player'),
          onKickPlayer,
        ])
        slotActions.push([
          user
            ? t('lobbies.slots.banPlayer', {
                defaultValue: 'Ban {{user}}',
                user: user.name,
              })
            : t('lobbies.slots.banUnnamedPlayer', 'Ban player'),
          onBanPlayer,
        ])
      } else {
        slotActions.push([t('lobbies.slots.removeComputer', 'Remove computer'), onKickPlayer])
      }
    }
    if (canMakeObserver && onMakeObserver) {
      slotActions.push([t('lobbies.slots.makeObserver', 'Make observer'), onMakeObserver])
    }
    if (canRemoveObserver && onRemoveObserver) {
      slotActions.push([t('lobbies.slots.makePlayer', 'Make player'), onRemoveObserver])
    }
    if (onMoveSlot) {
      slotActions.push([t('lobbies.slots.moveToSlot', 'Move to…'), onMoveSlot])
    }
  }

  return (
    <InGameSlot data-testid='lobby-slot' $inGame={inGame}>
      <SlotLeft>
        <SlotProfile>
          {avatar}
          <SlotName as='span'>{displayName}</SlotName>
          {inGame ? <InGameTag>{t('lobbies.lobby.inGame', 'In game')}</InGameTag> : null}
        </SlotProfile>
        {slotActions.length > 0 ? (
          <SlotActions slotActions={slotActions as [string, () => void][]} />
        ) : (
          <div />
        )}
      </SlotLeft>
      <SlotRight>
        <Controls
          isObserver={isObserver}
          canSetRace={canSetRace}
          race={race}
          onSetRace={onSetRace}
        />
      </SlotRight>
    </InGameSlot>
  )
}

function Controls({
  isObserver,
  canSetRace,
  race,
  onSetRace,
}: {
  isObserver?: boolean
  canSetRace?: boolean
  race: RaceChar
  onSetRace?: (race: RaceChar) => void
}) {
  if (isObserver) {
    return null
  }
  return canSetRace ? (
    <RacePicker race={race} onSetRace={onSetRace} />
  ) : (
    <SelectedRace race={race} />
  )
}
