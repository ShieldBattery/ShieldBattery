import { Record } from 'immutable'
import cuid from 'cuid'

const Player = new Record({ name: null, id: null, race: 'r', isComputer: false, slot: -1 })

export function createHuman(name, race, slot) {
  return new Player({ name, race, id: cuid(), isComputer: false, slot })
}

export function createComputer(race, slot) {
  return new Player({ name: 'robit', race, id: cuid(), isComputer: true, slot })
}
