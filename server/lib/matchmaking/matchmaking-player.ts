import { Record, Set } from 'immutable'
import { AssignedRaceChar, RaceChar } from '../../../common/races'

export const createInterval = Record({
  low: 0,
  high: 0,
})

export type Interval = ReturnType<typeof createInterval>

export const createPlayer = Record({
  id: -1,
  name: '',
  rating: -1,
  interval: createInterval(),
  race: 'z' as RaceChar,
  useAlternateRace: false,
  alternateRace: 'z' as AssignedRaceChar,
  preferredMaps: Set<string>(),
})

export type Player = ReturnType<typeof createPlayer>
