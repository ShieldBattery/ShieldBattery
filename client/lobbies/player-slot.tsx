import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { RaceChar } from '../../common/races'
import { Avatar } from '../avatars/avatar'
import ComputerAvatar from '../avatars/computer-avatar'
import { RacePicker } from './race-picker'
import { SelectedRace } from './selected-race'
import { Slot, SlotLeft, SlotName, SlotProfile, SlotRight } from './slot'
import { SlotActions } from './slot-actions'

const StyledAvatar = styled(Avatar)`
  flex-grow: 0;
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  margin-right: 16px;
`

export interface PlayerSlotProps {
  name: string
  isComputer?: boolean
  isHost?: boolean
  canMakeObserver?: boolean
  canRemoveObserver?: boolean
  isSelf?: boolean
  isObserver?: boolean
  canSetRace?: boolean
  race?: RaceChar
  onSetRace?: (race: RaceChar) => void
  onCloseSlot?: () => void
  onKickPlayer?: () => void
  onBanPlayer?: () => void
  onMakeObserver?: () => void
  onRemoveObserver?: () => void
}

export function PlayerSlot({
  name,
  isComputer,
  isHost,
  canMakeObserver,
  canRemoveObserver,
  isSelf,
  isObserver,
  canSetRace,
  race = 'r',
  onSetRace,
  onCloseSlot,
  onKickPlayer,
  onBanPlayer,
  onMakeObserver,
  onRemoveObserver,
}: PlayerSlotProps) {
  const { t } = useTranslation()

  const avatar = isComputer ? <StyledAvatar as={ComputerAvatar} /> : <StyledAvatar user={name} />
  const displayName = isComputer ? t('game.playerName.computer', 'Computer') : name

  const slotActions: [string, (() => void) | undefined][] = []
  if (isHost) {
    if (!isSelf) {
      slotActions.push([t('lobbies.slots.closeSlot', 'Close slot'), onCloseSlot])
      if (!isComputer) {
        slotActions.push([t('lobbies.slots.kickPlayer', 'Kick player'), onKickPlayer])
        slotActions.push([t('lobbies.slots.banPlayer', 'Ban player'), onBanPlayer])
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
  }

  return (
    <Slot>
      <SlotLeft>
        <SlotProfile>
          {avatar}
          <SlotName as='span'>{displayName}</SlotName>
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
    </Slot>
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
