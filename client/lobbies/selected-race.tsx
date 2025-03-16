import React from 'react'
import { ALL_RACE_CHARS, RaceChar } from '../../common/races'
import { RacePicker } from './race-picker'

export interface SelectedRaceProps {
  race: RaceChar
}

/** A RacePicker, but for uncontrollable lobby slots. */
export function SelectedRace({ race }: SelectedRaceProps) {
  const hiddenRaces = ALL_RACE_CHARS.filter(r => r !== race)

  return <RacePicker race={race} hiddenRaces={hiddenRaces} allowInteraction={false} />
}
