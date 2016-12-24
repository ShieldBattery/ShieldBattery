import { Record } from 'immutable'
import cuid from 'cuid'

const Player = new Record({
  name: null,
  id: null,
  race: 'r',
  isComputer: false,
  slot: -1,
  controlledBy: null,
})

export function createHuman(name, race, slot) {
  return new Player({
    name,
    race,
    id: cuid(),
    isComputer: false,
    slot
  })
}

export function createComputer(race, slot) {
  return new Player({
    name: '|robit',
    race,
    id: cuid(),
    isComputer: true,
    slot
  })
}

// Creates a slot that is open (can still be used for joining players), but is controlled by a
// particular player for as long as it is unoccupied. These are used for Team games (e.g.
// Team Melee), where open slots still affect the composition of starting units.
export function createControlledOpen(controllerId, race, slot) {
  return new Player({
    name: '|open',
    race,
    id: cuid(),
    isComputer: false,
    slot,
    controlledBy: controllerId,
  })
}
