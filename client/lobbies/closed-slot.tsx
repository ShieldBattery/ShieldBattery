import { useTranslation } from 'react-i18next'
import { RaceChar } from '../../common/races'
import { RacePicker } from './race-picker'
import { SelectedRace } from './selected-race'
import { Slot, SlotEmptyAvatar, SlotEmptyName, SlotLeft, SlotProfile, SlotRight } from './slot'
import { SlotActions } from './slot-actions'

export interface ClosedSlotProps {
  isHost?: boolean
  isObserver?: boolean
  controlledClosed?: boolean
  canSetRace?: boolean
  race?: RaceChar
  onSetRace?: (race: RaceChar) => void
  onAddComputer?: () => void
  onOpenSlot: () => void
}

export function ClosedSlot({
  isHost,
  isObserver,
  controlledClosed,
  canSetRace,
  race = 'r',
  onSetRace,
  onAddComputer,
  onOpenSlot,
}: ClosedSlotProps) {
  const { t } = useTranslation()

  const slotActions: [string, () => void][] = []
  if (isHost) {
    slotActions.push([t('lobbies.slots.openSlot', 'Open slot'), onOpenSlot])
    if (!controlledClosed && !isObserver && onAddComputer) {
      slotActions.push([t('lobbies.slots.addComputer', 'Add computer'), onAddComputer])
    }
  }

  return (
    <Slot data-testid='lobby-slot'>
      <SlotLeft>
        <SlotProfile>
          <SlotEmptyAvatar />
          <SlotEmptyName as='span'>{t('lobbies.slots.name', 'Closed')}</SlotEmptyName>
        </SlotProfile>
        {slotActions.length > 0 ? <SlotActions slotActions={slotActions} /> : <div />}
      </SlotLeft>
      <SlotRight>
        <Controls
          controlledClosed={controlledClosed}
          canSetRace={canSetRace}
          race={race}
          onSetRace={onSetRace}
        />
      </SlotRight>
    </Slot>
  )
}

function Controls({
  controlledClosed,
  canSetRace,
  race,
  onSetRace,
}: {
  controlledClosed?: boolean
  canSetRace?: boolean
  race: RaceChar
  onSetRace?: (race: RaceChar) => void
}) {
  if (controlledClosed) {
    return canSetRace ? (
      <RacePicker race={race} onSetRace={onSetRace} />
    ) : (
      <SelectedRace race={race} />
    )
  } else {
    return null
  }
}
