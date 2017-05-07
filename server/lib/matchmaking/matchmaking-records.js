import { Map, Record } from 'immutable'

export const Interval = new Record({
  low: 0,
  high: 0,
})

export const Player = new Record({
  name: null,
  rating: 0,
  interval: new Interval(),
  race: 'r',
})

export const Match = new Record({
  id: null,
  type: null,
  players: new Map(),
})
