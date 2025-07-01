import { MouseEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RaceChar } from '../../common/races'
import { MaterialIcon } from '../icons/material/material-icon'
import { RacePicker } from './race-picker'
import { SelectedRace } from './selected-race'
import { Slot, SlotEmptyAvatar, SlotEmptyName, SlotLeft, SlotProfileOpen, SlotRight } from './slot'
import { SlotActions } from './slot-actions'

export interface OpenSlotProps {
  isHost?: boolean
  isObserver?: boolean
  canMakeObserver?: boolean
  canRemoveObserver?: boolean
  controlledOpen?: boolean
  canSetRace?: boolean
  race?: RaceChar
  onSetRace?: (race: RaceChar) => void
  onAddComputer?: () => void
  onSwitchClick: (event: MouseEvent<HTMLDivElement>) => void
  onCloseSlot: () => void
  onMakeObserver?: () => void
  onRemoveObserver?: () => void
}

export function OpenSlot({
  isHost,
  isObserver,
  canMakeObserver,
  canRemoveObserver,
  controlledOpen,
  canSetRace,
  race = 'r',
  onSetRace,
  onAddComputer,
  onSwitchClick,
  onCloseSlot,
  onMakeObserver,
  onRemoveObserver,
}: OpenSlotProps) {
  const { t } = useTranslation()
  const [isHovered, setIsHovered] = useState(false)

  const slotActions: [string, () => void][] = []
  if (isHost) {
    slotActions.push([t('lobbies.slots.closeSlot', 'Close slot'), onCloseSlot])
    if (!controlledOpen && !isObserver && onAddComputer) {
      slotActions.push([t('lobbies.slots.addComputer', 'Add computer'), onAddComputer])
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
        <SlotProfileOpen
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          onClick={onSwitchClick}>
          <SlotEmptyAvatar>{isHovered ? <MaterialIcon icon='swap_vert' /> : null}</SlotEmptyAvatar>
          <SlotEmptyName as='span'>{t('lobbies.slots.open', 'Open')}</SlotEmptyName>
        </SlotProfileOpen>
        {slotActions.length > 0 ? <SlotActions slotActions={slotActions} /> : <div />}
      </SlotLeft>
      <SlotRight>
        <Controls
          race={race}
          controlledOpen={controlledOpen}
          canSetRace={canSetRace}
          onSetRace={onSetRace}
        />
      </SlotRight>
    </Slot>
  )
}

function Controls({
  race,
  controlledOpen,
  canSetRace,
  onSetRace,
}: {
  race: RaceChar
  controlledOpen?: boolean
  canSetRace?: boolean
  onSetRace?: (race: RaceChar) => void
}) {
  if (controlledOpen) {
    return canSetRace ? (
      <RacePicker race={race} onSetRace={onSetRace} />
    ) : (
      <SelectedRace race={race} />
    )
  } else {
    return null
  }
}
