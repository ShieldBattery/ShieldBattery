import React from 'react'
import { AssignedRaceChar, RaceChar } from '../../common/races'
import { RacePicker, RacePickerProps } from '../lobbies/race-picker'

export type RaceSelectOnChangeFunc<AllowRandom extends boolean | undefined> =
  AllowRandom extends false ? (race: AssignedRaceChar) => void : (race: RaceChar) => void

export interface RaceSelectProps<AllowRandom extends boolean | undefined>
  extends Omit<RacePickerProps<AllowRandom>, 'race' | 'onSetRace'> {
  value: RaceChar | null
  onChange: RaceSelectOnChangeFunc<AllowRandom>
}

/** A wrapper around <RacePicker /> so it can be used in forms **/
export function RaceSelect<AllowRandom extends boolean | undefined>(
  props: RaceSelectProps<AllowRandom>,
) {
  const { value, onChange, ...restProps } = props

  return <RacePicker {...restProps} race={value!} onSetRace={onChange} />
}
