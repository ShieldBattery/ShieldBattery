import * as Lobbies from './lobby'
import * as Slots from './slot'
import {
  findSlotByName,
  findSlotById,
  humanSlotCount,
  hasOpposingSides,
} from '../../../common/lobbies'

const BigGameHunters = {
  name: 'Big Game Hunters.scm',
  mapData: {},
}

const BOXER_LOBBY = Lobbies.create(
  '5v3 Comp Stomp Pros Only',
  BigGameHunters,
  'melee',
  0,
  4,
  'Slayers`Boxer',
  27,
)

const BOXER_LOBBY_WITH_OBSERVERS = Lobbies.create(
  '5v3 Comp Stomp Pros Only',
  BigGameHunters,
  'melee',
  0,
  4,
  'Slayers`Boxer',
  27,
  'r',
  true,
)

const evaluateMeleeLobby = (lobby, teamSize) => {
  expect(lobby.teams).toHaveProperty('size', teamSize)
  const team = lobby.teams.get(0)
  expect(team.slots).toHaveProperty('size', 4)
  expect(humanSlotCount(lobby)).toBe(1)
  expect(hasOpposingSides(lobby)).toBeFalse()
  const player = team.slots.get(0)
  expect(player.type).toBe('human')
  expect(player.name).toBe('Slayers`Boxer')
  expect(player.race).toBe('r')
  expect(player).toEqual(lobby.host)
  expect(team.slots.get(1).type).toBe('open')
  expect(team.slots.get(2).type).toBe('open')
  expect(team.slots.get(3).type).toBe('open')
}

const evaluateSummarizedJson = (lobby, openSlotCount) => {
  const json = JSON.stringify(Lobbies.toSummaryJson(lobby))
  const parsed = JSON.parse(json)

  const id = lobby.host.id
  expect(parsed).toEqual({
    name: '5v3 Comp Stomp Pros Only',
    map: BigGameHunters,
    gameType: 'melee',
    gameSubType: 0,
    host: { name: 'Slayers`Boxer', id },
    openSlotCount,
  })
}

describe('Lobbies - melee', () => {
  test('should create the lobby correctly', () => {
    evaluateMeleeLobby(BOXER_LOBBY, 1)

    let l = BOXER_LOBBY_WITH_OBSERVERS
    evaluateMeleeLobby(l, 2)
    let observers = l.teams.get(1)
    expect(observers.slots).toHaveProperty('size', 4)
    expect(observers.slots.get(0).type).toBe('closed')
    expect(observers.slots.get(1).type).toBe('closed')
    expect(observers.slots.get(2).type).toBe('closed')
    expect(observers.slots.get(3).type).toBe('closed')

    l = Lobbies.openSlot(l, 1, 0)
    observers = l.teams.get(1)
    expect(observers.slots.get(0).type).toBe('open')
    expect(observers.slots.get(1).type).toBe('closed')
    expect(observers.slots.get(2).type).toBe('closed')
    expect(observers.slots.get(3).type).toBe('closed')
  })

  test('should support summarized JSON serialization', () => {
    evaluateSummarizedJson(BOXER_LOBBY, 3)
    evaluateSummarizedJson(BOXER_LOBBY_WITH_OBSERVERS, 3)
    evaluateSummarizedJson(Lobbies.openSlot(BOXER_LOBBY_WITH_OBSERVERS, 1, 0), 4)
  })

  test('should find available slot', () => {
    const [t1, s1] = Lobbies.findAvailableSlot(BOXER_LOBBY)
    expect(t1).toBe(0)
    expect(s1).toBe(1)

    const fullLobby = Lobbies.create('Full', BigGameHunters, 'melee', 0, 1, 'pachi', 2)
    const [t2, s2] = Lobbies.findAvailableSlot(fullLobby)
    expect(t2).toBe(-1)
    expect(s2).toBe(-1)

    let fullLobbyWithObservers = Lobbies.create(
      'Full',
      BigGameHunters,
      'melee',
      0,
      1,
      'pachi',
      2,
      'r',
      true,
    )
    const [t3, s3] = Lobbies.findAvailableSlot(fullLobbyWithObservers)
    expect(t3).toBe(-1)
    expect(s3).toBe(-1)
    fullLobbyWithObservers = Lobbies.openSlot(fullLobbyWithObservers, 1, 0)
    const [t4, s4] = Lobbies.findAvailableSlot(fullLobbyWithObservers)
    expect(t4).toBe(1)
    expect(s4).toBe(0)
  })

  test('should support adding players', () => {
    const babo = Slots.createHuman('dronebabo', 1, 'z')
    const pachi = Slots.createHuman('pachi', 2, 'p')

    const orig = BOXER_LOBBY
    let lobby = orig

    const [t1, s1] = Lobbies.findAvailableSlot(lobby)
    lobby = Lobbies.addPlayer(lobby, t1, s1, babo)
    expect(lobby).not.toEqual(orig)
    const [, , p1] = findSlotById(lobby, babo.id)
    expect(p1).toEqual(babo)
    expect(humanSlotCount(lobby)).toBe(2)
    expect(hasOpposingSides(lobby)).toBeTrue()

    const [t2, s2] = Lobbies.findAvailableSlot(lobby)
    lobby = Lobbies.addPlayer(lobby, t2, s2, pachi)
    expect(lobby).not.toEqual(orig)
    const [, , p2] = findSlotById(lobby, pachi.id)
    expect(p2).toEqual(pachi)
    expect(humanSlotCount(lobby)).toBe(3)
  })

  test('should support removing players', () => {
    const orig = BOXER_LOBBY
    const [t1, s1, p1] = findSlotByName(orig, 'asdf')
    let lobby = Lobbies.removePlayer(orig, t1, s1, p1)
    expect(lobby).toEqual(orig)

    const babo = Slots.createHuman('dronebabo', 1, 'z')
    const [t2, s2] = Lobbies.findAvailableSlot(lobby)
    lobby = Lobbies.addPlayer(lobby, t2, s2, babo)
    const beforeRemoval = lobby
    lobby = Lobbies.removePlayer(lobby, t2, s2, babo)

    expect(lobby).not.toEqual(beforeRemoval)
    expect(humanSlotCount(lobby)).toBe(1)
    expect(lobby.teams.get(t2).slots.get(s2).type).toBe('open')

    const [t3, s3, host] = findSlotByName(lobby, lobby.host.name)
    lobby = Lobbies.removePlayer(lobby, t3, s3, host)
    expect(lobby).toBeNull()
  })

  test('should support setting the race of a player', () => {
    const computer = Slots.createComputer('t')
    const [t1, s1] = Lobbies.findAvailableSlot(BOXER_LOBBY)
    let lobby = Lobbies.addPlayer(BOXER_LOBBY, t1, s1, computer)

    lobby = Lobbies.setRace(lobby, t1, s1, 'z')

    expect(lobby.teams.get(t1).slots.get(s1).race).toBe('z')
  })

  test('should support finding players by name', () => {
    const computer = Slots.createComputer('p')
    const [t1, s1] = Lobbies.findAvailableSlot(BOXER_LOBBY)
    const lobby = Lobbies.addPlayer(BOXER_LOBBY, t1, s1, computer)

    const [, , p1] = findSlotByName(lobby, 'asdf')
    expect(p1).toBeUndefined()

    const [, , p2] = findSlotByName(lobby, computer.name)
    expect(p2).toBeUndefined()

    const [, , p3] = findSlotByName(lobby, 'Slayers`Boxer')
    expect(p3).not.toBeUndefined()
    expect(p3.type).toBe('human')
    expect(p3.name).toBe('Slayers`Boxer')
  })

  test('should support finding players by id', () => {
    const computer = Slots.createComputer('p')
    const [t1, s1] = Lobbies.findAvailableSlot(BOXER_LOBBY)
    const lobby = Lobbies.addPlayer(BOXER_LOBBY, t1, s1, computer)

    const [, , p1] = findSlotById(lobby, 10)
    expect(p1).toBeUndefined()

    const [, , p2] = findSlotById(lobby, computer.id)
    expect(p2).not.toBeUndefined()
    expect(p2.type).toBe('computer')
    expect(p2.name).toBe('Computer')
    expect(p2.race).toBe('p')
  })

  test('should close the lobby if only computers are left', () => {
    const computer = Slots.createComputer('p')
    const [t1, s1] = Lobbies.findAvailableSlot(BOXER_LOBBY)
    let lobby = Lobbies.addPlayer(BOXER_LOBBY, t1, s1, computer)

    const [t2, s2, p1] = findSlotById(lobby, lobby.host.id)
    lobby = Lobbies.removePlayer(lobby, t2, s2, p1)

    expect(lobby).toBeNull()
  })

  test('should support transferring host status to the next oldest player on host removal', () => {
    const computer = Slots.createComputer('p')
    const babo = Slots.createHuman('dronebabo', 1, 'z')
    const pachi = Slots.createHuman('pachi', 2, 't')
    const [t1, s1] = Lobbies.findAvailableSlot(BOXER_LOBBY)
    let lobby = Lobbies.addPlayer(BOXER_LOBBY, t1, s1, computer)
    const [t2, s2] = Lobbies.findAvailableSlot(lobby)
    lobby = Lobbies.addPlayer(lobby, t2, s2, babo)
    const [t3, s3] = Lobbies.findAvailableSlot(lobby)
    lobby = Lobbies.addPlayer(lobby, t3, s3, pachi)

    const [t4, s4, p1] = findSlotById(lobby, lobby.host.id)
    lobby = Lobbies.removePlayer(lobby, t4, s4, p1)

    expect(lobby.host).toBe(babo)
  })

  test('should support moving players between slots', () => {
    const babo = Slots.createHuman('dronebabo', 1, 'z')
    const [t1, s1] = Lobbies.findAvailableSlot(BOXER_LOBBY)
    let lobby = Lobbies.addPlayer(BOXER_LOBBY, t1, s1, babo)
    lobby = Lobbies.movePlayerToSlot(lobby, t1, s1, 0, 3)

    expect(humanSlotCount(lobby)).toBe(2)
    expect(lobby.teams.get(0).slots.get(3)).toBe(babo)
    expect(lobby.teams.get(t1).slots.get(s1).type).toBe('open')
  })

  test('should support closing an open slot', () => {
    let lobby = BOXER_LOBBY
    expect(lobby.teams.get(0).slots.get(0)).toEqual(lobby.host)
    expect(lobby.teams.get(0).slots.get(1).type).toBe('open')
    expect(lobby.teams.get(0).slots.get(2).type).toBe('open')
    expect(lobby.teams.get(0).slots.get(3).type).toBe('open')

    lobby = Lobbies.closeSlot(lobby, 0, 1)
    expect(lobby.teams.get(0).slots.get(0)).toEqual(lobby.host)
    expect(lobby.teams.get(0).slots.get(1).type).toBe('closed')
    expect(lobby.teams.get(0).slots.get(2).type).toBe('open')
    expect(lobby.teams.get(0).slots.get(3).type).toBe('open')

    expect(() => Lobbies.closeSlot(lobby, 0, 0)).toThrow()
    expect(() => Lobbies.closeSlot(lobby, 0, 1)).toThrow()
  })

  test('should support opening a closed slot', () => {
    let lobby = BOXER_LOBBY
    expect(lobby.teams.get(0).slots.get(0)).toEqual(lobby.host)
    expect(lobby.teams.get(0).slots.get(1).type).toBe('open')
    expect(lobby.teams.get(0).slots.get(2).type).toBe('open')
    expect(lobby.teams.get(0).slots.get(3).type).toBe('open')

    lobby = Lobbies.closeSlot(lobby, 0, 1)
    expect(lobby.teams.get(0).slots.get(0)).toEqual(lobby.host)
    expect(lobby.teams.get(0).slots.get(1).type).toBe('closed')
    expect(lobby.teams.get(0).slots.get(2).type).toBe('open')
    expect(lobby.teams.get(0).slots.get(3).type).toBe('open')

    lobby = Lobbies.openSlot(lobby, 0, 1)
    expect(lobby.teams.get(0).slots.get(0)).toEqual(lobby.host)
    expect(lobby.teams.get(0).slots.get(1).type).toBe('open')
    expect(lobby.teams.get(0).slots.get(2).type).toBe('open')
    expect(lobby.teams.get(0).slots.get(3).type).toBe('open')

    expect(() => Lobbies.openSlot(lobby, 0, 0)).toThrow()
    expect(() => Lobbies.openSlot(lobby, 0, 1)).toThrow()
  })

  test('should support adding observer slots', () => {
    let lobby = BOXER_LOBBY_WITH_OBSERVERS
    let players = lobby.teams.get(0)
    let observers = lobby.teams.get(1)
    expect(players.slots).toHaveProperty('size', 4)
    expect(observers.slots).toHaveProperty('size', 4)

    lobby = Lobbies.makeObserver(lobby, 0, 0)
    players = lobby.teams.get(0)
    observers = lobby.teams.get(1)
    expect(players.slots).toHaveProperty('size', 3)
    expect(observers.slots).toHaveProperty('size', 5)
    expect(players.slots.get(0).type).toBe('open')
    expect(players.slots.get(1).type).toBe('open')
    expect(players.slots.get(2).type).toBe('open')
    expect(observers.slots.get(4).id).toBe(lobby.host.id)

    const babo = Slots.createHuman('dronebabo', 1, 'z')
    const pachi = Slots.createHuman('pachi', 2, 'p')
    const computer = Slots.createComputer('p')
    lobby = Lobbies.addPlayer(lobby, 0, 0, babo)
    lobby = Lobbies.addPlayer(lobby, 0, 1, pachi)
    lobby = Lobbies.addPlayer(lobby, 0, 2, computer)
    expect(() => Lobbies.makeObserver(lobby, 0, 2)).toThrow()
    lobby = Lobbies.makeObserver(lobby, 0, 1)
    expect(() => Lobbies.makeObserver(lobby, 0, 0)).toThrow()

    players = lobby.teams.get(0)
    observers = lobby.teams.get(1)
    expect(players.slots).toHaveProperty('size', 2)
    expect(observers.slots).toHaveProperty('size', 6)
    expect(players.slots.get(0).type).toBe('human')
    expect(players.slots.get(0).name).toBe('dronebabo')
    expect(players.slots.get(1).type).toBe('computer')
    expect(observers.slots.get(0).type).toBe('closed')
    expect(observers.slots.get(1).type).toBe('closed')
    expect(observers.slots.get(2).type).toBe('closed')
    expect(observers.slots.get(3).type).toBe('closed')
    expect(observers.slots.get(4).name).toBe('Slayers`Boxer')
    expect(observers.slots.get(5).name).toBe('pachi')

    expect(() => Lobbies.makeObserver(lobby, 0, 0)).toThrow()
  })

  test('should support removing observer slots', () => {
    let lobby = BOXER_LOBBY_WITH_OBSERVERS

    const babo = Slots.createHuman('dronebabo', 1, 'z')
    lobby = Lobbies.addPlayer(lobby, 0, 1, babo)

    let players = lobby.teams.get(0)
    let observers = lobby.teams.get(1)
    expect(players.slots).toHaveProperty('size', 4)
    expect(observers.slots).toHaveProperty('size', 4)
    expect(() => Lobbies.removeObserver(lobby, 0)).toThrow()

    // Move boxer and open slot to obs
    lobby = Lobbies.makeObserver(lobby, 0, 0)
    lobby = Lobbies.makeObserver(lobby, 0, 1)
    // Move closed and boxer back
    lobby = Lobbies.removeObserver(lobby, 1)
    lobby = Lobbies.removeObserver(lobby, 3)
    players = lobby.teams.get(0)
    observers = lobby.teams.get(1)

    expect(players.slots).toHaveProperty('size', 4)
    expect(observers.slots).toHaveProperty('size', 4)
    expect(() => Lobbies.removeObserver(lobby, 0)).toThrow()
    expect(players.slots.get(0).type).toBe('human')
    expect(players.slots.get(1).type).toBe('open')
    expect(players.slots.get(2).type).toBe('closed')
    expect(players.slots.get(3).type).toBe('human')
    expect(players.slots.get(3).name).toBe('Slayers`Boxer')

    expect(observers.slots.get(0).type).toBe('closed')
    expect(observers.slots.get(1).type).toBe('closed')
    expect(observers.slots.get(2).type).toBe('closed')
    expect(observers.slots.get(3).type).toBe('open')
  })
})

const TEAM_LOBBY = Lobbies.create(
  '2v6 BGH',
  BigGameHunters,
  'topVBottom',
  2,
  8,
  'Slayers`Boxer',
  27,
)

describe('Lobbies - Top vs bottom', () => {
  test('should create the lobby correctly', () => {
    const l = TEAM_LOBBY
    expect(l.teams).toHaveProperty('size', 2)
    const team1 = l.teams.get(0)
    expect(team1.slots).toHaveProperty('size', 2)
    const team2 = l.teams.get(1)
    expect(team2.slots).toHaveProperty('size', 6)
    expect(humanSlotCount(l)).toBe(1)
    expect(hasOpposingSides(l)).toBeFalse()
    const player = team1.slots.get(0)
    expect(player.type).toBe('human')
    expect(player.name).toBe('Slayers`Boxer')
    expect(player.race).toBe('r')
    expect(player).toEqual(l.host)
    expect(team1.slots.get(1).type).toBe('open')
    expect(team2.slots.get(0).type).toBe('open')
    expect(team2.slots.get(1).type).toBe('open')
    expect(team2.slots.get(2).type).toBe('open')
    expect(team2.slots.get(3).type).toBe('open')
    expect(team2.slots.get(4).type).toBe('open')
    expect(team2.slots.get(5).type).toBe('open')
  })

  test('should balance teams when adding new players', () => {
    expect(hasOpposingSides(TEAM_LOBBY)).toBeFalse()
    const [t1, s1] = Lobbies.findAvailableSlot(TEAM_LOBBY)
    expect(t1).toBe(1)
    expect(s1).toBe(0)
    const babo = Slots.createHuman('dronebabo', 1, 'z')
    let l = Lobbies.addPlayer(TEAM_LOBBY, t1, s1, babo)
    expect(hasOpposingSides(l)).toBeTrue()

    const [t2, s2] = Lobbies.findAvailableSlot(l)
    expect(t2).toBe(1)
    expect(s2).toBe(1)
    const pachi = Slots.createHuman('pachi', 2, 't')
    l = Lobbies.addPlayer(l, t2, s2, pachi)

    const [t3, s3] = Lobbies.findAvailableSlot(l)
    expect(t3).toBe(1)
    expect(s3).toBe(2)
    const computer1 = Slots.createComputer('p')
    l = Lobbies.addPlayer(l, t3, s3, computer1)

    const [t4, s4] = Lobbies.findAvailableSlot(l)
    expect(t4).toBe(1)
    expect(s4).toBe(3)
    const computer2 = Slots.createComputer('z')
    l = Lobbies.addPlayer(l, t4, s4, computer2)

    const [t5, s5] = Lobbies.findAvailableSlot(l)
    expect(t5).toBe(1)
    expect(s5).toBe(4)
    const computer3 = Slots.createComputer('z')
    l = Lobbies.addPlayer(l, t5, s5, computer3)

    const [t6, s6] = Lobbies.findAvailableSlot(l)
    expect(t6).toBe(0)
    expect(s6).toBe(1)
    const computer4 = Slots.createComputer('z')
    l = Lobbies.addPlayer(l, t6, s6, computer4)

    const [t7, s7] = Lobbies.findAvailableSlot(l)
    expect(t7).toBe(1)
    expect(s7).toBe(5)
    const computer5 = Slots.createComputer('z')
    l = Lobbies.addPlayer(l, t7, s7, computer5)

    const [t8, s8] = Lobbies.findAvailableSlot(l)
    expect(t8).toBe(-1)
    expect(s8).toBe(-1)
  })

  test('should support moving players between slots', () => {
    const [t1, s1] = Lobbies.findAvailableSlot(TEAM_LOBBY)
    const babo = Slots.createHuman('dronebabo', 1, 'z')
    let lobby = Lobbies.addPlayer(TEAM_LOBBY, t1, s1, babo)
    lobby = Lobbies.movePlayerToSlot(lobby, t1, s1, 1, 3)

    expect(humanSlotCount(lobby)).toBe(2)
    expect(lobby.teams.get(1).slots.get(3)).toBe(babo)
    expect(lobby.teams.get(t1).slots.get(s1).type).toBe('open')
  })
})

const TEAM_MELEE_2 = Lobbies.create(
  '4v4 Team Melee',
  BigGameHunters,
  'teamMelee',
  2,
  8,
  'Slayers`Boxer',
  27,
)
const TEAM_MELEE_3 = Lobbies.create(
  '3v3v2 Team Melee',
  BigGameHunters,
  'teamMelee',
  3,
  8,
  'Slayers`Boxer',
  27,
)
const TEAM_MELEE_4 = Lobbies.create(
  '2v2v2v2 Team Melee',
  BigGameHunters,
  'teamMelee',
  4,
  8,
  'Slayers`Boxer',
  27,
)

const evaluateControlledSlot = (slot, type, race, controlledBy) => {
  expect(slot.type).toBe(type)
  expect(slot.race).toBe(race)
  expect(slot.controlledBy).toBe(controlledBy)
}

describe('Lobbies - Team melee', () => {
  test('should create the lobby correctly', () => {
    const l2 = TEAM_MELEE_2
    expect(l2.teams).toHaveProperty('size', 2)
    let team1 = l2.teams.get(0)
    expect(team1.slots).toHaveProperty('size', 4)
    let team2 = l2.teams.get(1)
    expect(team2.slots).toHaveProperty('size', 4)
    expect(humanSlotCount(l2)).toBe(1)
    expect(hasOpposingSides(l2)).toBeFalse()
    let player = team1.slots.get(0)
    expect(player.type).toBe('human')
    expect(player.name).toBe('Slayers`Boxer')
    expect(player.race).toBe('r')
    expect(player).toEqual(l2.host)
    evaluateControlledSlot(team1.slots.get(1), 'controlledOpen', player.race, player.id)
    evaluateControlledSlot(team1.slots.get(2), 'controlledOpen', player.race, player.id)
    evaluateControlledSlot(team1.slots.get(3), 'controlledOpen', player.race, player.id)
    expect(team2.slots.get(0).type).toBe('open')
    expect(team2.slots.get(1).type).toBe('open')
    expect(team2.slots.get(2).type).toBe('open')
    expect(team2.slots.get(3).type).toBe('open')

    const l3 = TEAM_MELEE_3
    expect(l3.teams).toHaveProperty('size', 3)
    team1 = l3.teams.get(0)
    expect(team1.slots).toHaveProperty('size', 3)
    team2 = l3.teams.get(1)
    expect(team2.slots).toHaveProperty('size', 3)
    let team3 = l3.teams.get(2)
    expect(team3.slots).toHaveProperty('size', 2)
    expect(humanSlotCount(l3)).toBe(1)
    expect(hasOpposingSides(l3)).toBeFalse()
    player = team1.slots.get(0)
    expect(player.type).toBe('human')
    expect(player.name).toBe('Slayers`Boxer')
    expect(player.race).toBe('r')
    expect(player).toEqual(l3.host)
    evaluateControlledSlot(team1.slots.get(1), 'controlledOpen', player.race, player.id)
    evaluateControlledSlot(team1.slots.get(2), 'controlledOpen', player.race, player.id)
    expect(team2.slots.get(0).type).toBe('open')
    expect(team2.slots.get(1).type).toBe('open')
    expect(team2.slots.get(2).type).toBe('open')
    expect(team3.slots.get(0).type).toBe('open')
    expect(team3.slots.get(1).type).toBe('open')

    const l4 = TEAM_MELEE_4
    expect(l4.teams).toHaveProperty('size', 4)
    team1 = l4.teams.get(0)
    expect(team1.slots).toHaveProperty('size', 2)
    team2 = l4.teams.get(1)
    expect(team2.slots).toHaveProperty('size', 2)
    team3 = l4.teams.get(2)
    expect(team3.slots).toHaveProperty('size', 2)
    const team4 = l4.teams.get(3)
    expect(team4.slots).toHaveProperty('size', 2)
    expect(humanSlotCount(l4)).toBe(1)
    expect(hasOpposingSides(l4)).toBeFalse()
    player = team1.slots.get(0)
    expect(player.type).toBe('human')
    expect(player.name).toBe('Slayers`Boxer')
    expect(player.race).toBe('r')
    expect(player).toEqual(l4.host)
    evaluateControlledSlot(team1.slots.get(1), 'controlledOpen', player.race, player.id)
    expect(team2.slots.get(0).type).toBe('open')
    expect(team2.slots.get(1).type).toBe('open')
    expect(team3.slots.get(0).type).toBe('open')
    expect(team3.slots.get(1).type).toBe('open')
    expect(team4.slots.get(0).type).toBe('open')
    expect(team4.slots.get(1).type).toBe('open')
  })

  test('should fill team slots when a player is added to an empty team', () => {
    const babo = Slots.createHuman('dronebabo', 1, 'z')
    const l = Lobbies.addPlayer(TEAM_MELEE_2, 1, 0, babo)
    expect(humanSlotCount(l)).toBe(2)
    expect(hasOpposingSides(l)).toBeTrue()
    expect(l.teams.get(1).slots.get(0)).toEqual(babo)
    evaluateControlledSlot(l.teams.get(1).slots.get(1), 'controlledOpen', babo.race, babo.id)
  })

  test('should allow players to join slots that were previously controlled opens', () => {
    expect(TEAM_MELEE_4.teams.get(0).slots.get(1).type).toBe('controlledOpen')
    const babo = Slots.createHuman('dronebabo', 1, 'z')
    const l = Lobbies.addPlayer(TEAM_MELEE_4, 0, 1, babo)
    expect(humanSlotCount(l)).toBe(2)
    expect(hasOpposingSides(l)).toBeFalse()
    expect(l.teams.get(0).slots.get(1)).toEqual(babo)
  })

  test('should fill team slots with computers when a computer is added to an empty team', () => {
    const comp = Slots.createComputer('z')
    const l = Lobbies.addPlayer(TEAM_MELEE_4, 1, 0, comp)
    expect(humanSlotCount(l)).toBe(1)
    expect(hasOpposingSides(l)).toBeTrue()
    expect(l.teams.get(1).slots.get(0)).toEqual(comp)
    expect(l.teams.get(1).slots.get(1).type).toBe('computer')
  })

  test('should balance teams when adding new players', () => {
    expect(hasOpposingSides(TEAM_MELEE_4)).toBeFalse()
    const [t1, s1] = Lobbies.findAvailableSlot(TEAM_MELEE_4)
    expect(t1).toBe(1)
    expect(s1).toBe(0)
    const babo = Slots.createHuman('dronebabo', 1, 'z')
    let l = Lobbies.addPlayer(TEAM_MELEE_4, t1, s1, babo)
    expect(hasOpposingSides(l)).toBeTrue()

    const [t2, s2] = Lobbies.findAvailableSlot(l)
    expect(t2).toBe(2)
    expect(s2).toBe(0)
    const pachi = Slots.createHuman('pachi', 2, 't')
    l = Lobbies.addPlayer(l, t2, s2, pachi)

    const [t3, s3] = Lobbies.findAvailableSlot(l)
    expect(t3).toBe(3)
    expect(s3).toBe(0)
    const computer1 = Slots.createComputer('p')
    l = Lobbies.addPlayer(l, t3, s3, computer1)

    const [t4, s4] = Lobbies.findAvailableSlot(l)
    expect(t4).toBe(0)
    expect(s4).toBe(1)
    const trozz = Slots.createHuman('trozz', 3, 'p')
    l = Lobbies.addPlayer(l, t4, s4, trozz)

    const [t5, s5] = Lobbies.findAvailableSlot(l)
    expect(t5).toBe(1)
    expect(s5).toBe(1)
    const intothetest = Slots.createHuman('IntoTheTest', 4, 'p')
    l = Lobbies.addPlayer(l, t5, s5, intothetest)

    const [t6, s6] = Lobbies.findAvailableSlot(l)
    expect(t6).toBe(2)
    expect(s6).toBe(1)
    const harem = Slots.createHuman('harem', 5, 'p')
    l = Lobbies.addPlayer(l, t6, s6, harem)

    const [t7, s7] = Lobbies.findAvailableSlot(l)
    expect(t7).toBe(-1)
    expect(s7).toBe(-1)
  })

  test('should remove the controlled open slots when the last player on a team leaves', () => {
    const babo = Slots.createHuman('dronebabo', 1, 'z')
    let l = Lobbies.addPlayer(TEAM_MELEE_4, 1, 0, babo)
    evaluateControlledSlot(l.teams.get(1).slots.get(1), 'controlledOpen', babo.race, babo.id)
    l = Lobbies.removePlayer(l, 1, 0, babo)

    expect(humanSlotCount(l)).toBe(1)
    expect(hasOpposingSides(l)).toBeFalse()
    expect(l.teams.get(1).slots.get(0).type).toBe('open')
    expect(l.teams.get(1).slots.get(1).type).toBe('open')

    expect(Lobbies.removePlayer(l, 0, 0, l.host)).toBeNull()
  })

  test('should remove all the computers in a team whenever one of the computers is removed', () => {
    const comp1 = Slots.createComputer('z')
    let l = Lobbies.addPlayer(TEAM_MELEE_4, 1, 0, comp1)
    const comp2 = l.teams.get(1).slots.get(1)
    expect(comp2.type).toBe('computer')
    expect(comp2.race).toBe(comp1.race)
    l = Lobbies.removePlayer(l, 1, 0, comp1)

    expect(humanSlotCount(l)).toBe(1)
    expect(hasOpposingSides(l)).toBeFalse()
    expect(l.teams.get(1).slots.get(0).type).toBe('open')
    expect(l.teams.get(1).slots.get(1).type).toBe('open')

    expect(l.host.name).toBe('Slayers`Boxer')
  })

  test('should reassign slot control if the controller leaves', () => {
    const babo = Slots.createHuman('dronebabo', 1, 'z')
    let l = Lobbies.addPlayer(TEAM_MELEE_2, 0, 1, babo)
    l = Lobbies.removePlayer(l, 0, 0, l.host)

    expect(humanSlotCount(l)).toBe(1)
    expect(hasOpposingSides(l)).toBeFalse()
    expect(l.host).toEqual(babo)
    expect(l.teams.get(0).slots.get(1)).toEqual(babo)
    const controlledOpen = l.teams.get(0).slots.get(0)
    evaluateControlledSlot(controlledOpen, 'controlledOpen', 'r', babo.id)
    // Ensure the player in the leaving player's slot got a new ID
    expect(controlledOpen.id).not.toEqual(TEAM_MELEE_2.host.id)
    evaluateControlledSlot(l.teams.get(0).slots.get(2), 'controlledOpen', 'r', babo.id)
    evaluateControlledSlot(l.teams.get(0).slots.get(3), 'controlledOpen', 'r', babo.id)
  })

  test('should support moving players between slots in the same team', () => {
    const babo = Slots.createHuman('dronebabo', 1, 'z')
    let l = Lobbies.addPlayer(TEAM_MELEE_2, 0, 1, babo)
    l = Lobbies.movePlayerToSlot(l, 0, 1, 0, 2)

    expect(humanSlotCount(l)).toBe(2)
    expect(hasOpposingSides(l)).toBeFalse()

    evaluateControlledSlot(l.teams.get(0).slots.get(1), 'controlledOpen', 'r', l.host.id)
    evaluateControlledSlot(l.teams.get(0).slots.get(3), 'controlledOpen', l.host.race, l.host.id)
  })

  test('should support closing an open slot', () => {
    let lobby = TEAM_MELEE_2
    expect(lobby.teams.get(0).slots.get(0)).toEqual(lobby.host)
    const openSlot = lobby.teams.get(0).slots.get(1)
    expect(openSlot.type).toBe('controlledOpen')
    expect(lobby.teams.get(0).slots.get(2).type).toBe('controlledOpen')
    expect(lobby.teams.get(0).slots.get(3).type).toBe('controlledOpen')
    expect(lobby.teams.get(1).slots.get(0).type).toBe('open')
    expect(lobby.teams.get(1).slots.get(1).type).toBe('open')
    expect(lobby.teams.get(1).slots.get(2).type).toBe('open')
    expect(lobby.teams.get(1).slots.get(3).type).toBe('open')

    lobby = Lobbies.closeSlot(lobby, 0, 1, openSlot)
    expect(lobby.teams.get(0).slots.get(0)).toEqual(lobby.host)
    const closedSlot = lobby.teams.get(0).slots.get(1)
    expect(closedSlot.type).toBe('controlledClosed')
    expect(closedSlot.race).toBe(openSlot.race)
    expect(closedSlot.controlledBy).toBe(openSlot.controlledBy)
    expect(lobby.teams.get(0).slots.get(2).type).toBe('controlledOpen')
    expect(lobby.teams.get(0).slots.get(3).type).toBe('controlledOpen')
    expect(lobby.teams.get(1).slots.get(0).type).toBe('open')
    expect(lobby.teams.get(1).slots.get(1).type).toBe('open')
    expect(lobby.teams.get(1).slots.get(2).type).toBe('open')
    expect(lobby.teams.get(1).slots.get(3).type).toBe('open')

    expect(() => Lobbies.closeSlot(lobby, 0, 0)).toThrow()
    expect(() => Lobbies.closeSlot(lobby, 0, 1)).toThrow()
  })

  test('should support opening a closed slot', () => {
    let lobby = TEAM_MELEE_2
    expect(lobby.teams.get(0).slots.get(0)).toEqual(lobby.host)
    const openSlot1 = lobby.teams.get(0).slots.get(1)
    expect(openSlot1.type).toBe('controlledOpen')
    expect(openSlot1.race).toBe(lobby.host.race)
    expect(openSlot1.controlledBy).toBe(lobby.host.id)
    expect(lobby.teams.get(0).slots.get(2).type).toBe('controlledOpen')
    expect(lobby.teams.get(0).slots.get(3).type).toBe('controlledOpen')
    expect(lobby.teams.get(1).slots.get(0).type).toBe('open')
    expect(lobby.teams.get(1).slots.get(1).type).toBe('open')
    expect(lobby.teams.get(1).slots.get(2).type).toBe('open')
    expect(lobby.teams.get(1).slots.get(3).type).toBe('open')

    lobby = Lobbies.closeSlot(lobby, 0, 1)
    expect(lobby.teams.get(0).slots.get(0)).toEqual(lobby.host)
    const closedSlot = lobby.teams.get(0).slots.get(1)
    expect(closedSlot.type).toBe('controlledClosed')
    expect(closedSlot.race).toBe(openSlot1.race)
    expect(closedSlot.controlledBy).toBe(openSlot1.controlledBy)
    expect(lobby.teams.get(0).slots.get(2).type).toBe('controlledOpen')
    expect(lobby.teams.get(0).slots.get(3).type).toBe('controlledOpen')
    expect(lobby.teams.get(1).slots.get(0).type).toBe('open')
    expect(lobby.teams.get(1).slots.get(1).type).toBe('open')
    expect(lobby.teams.get(1).slots.get(2).type).toBe('open')
    expect(lobby.teams.get(1).slots.get(3).type).toBe('open')

    lobby = Lobbies.openSlot(lobby, 0, 1)
    expect(lobby.teams.get(0).slots.get(0)).toEqual(lobby.host)
    const openSlot2 = lobby.teams.get(0).slots.get(1)
    expect(openSlot2.type).toBe('controlledOpen')
    expect(openSlot2.race).toBe(closedSlot.race)
    expect(openSlot2.controlledBy).toBe(closedSlot.controlledBy)
    expect(lobby.teams.get(0).slots.get(2).type).toBe('controlledOpen')
    expect(lobby.teams.get(0).slots.get(3).type).toBe('controlledOpen')
    expect(lobby.teams.get(1).slots.get(0).type).toBe('open')
    expect(lobby.teams.get(1).slots.get(1).type).toBe('open')
    expect(lobby.teams.get(1).slots.get(2).type).toBe('open')
    expect(lobby.teams.get(1).slots.get(3).type).toBe('open')

    expect(() => Lobbies.openSlot(lobby, 0, 0)).toThrow()
    expect(() => Lobbies.openSlot(lobby, 0, 1)).toThrow()
  })

  test('should only allow a single race for computer teams', () => {
    const comp = Slots.createComputer('t')
    let lobby = Lobbies.addPlayer(TEAM_MELEE_3, 1, 0, comp)
    expect(lobby.teams.get(1).slots.get(0)).toEqual(comp)
    expect(lobby.teams.get(1).slots.get(1).race).toBe('t')
    expect(lobby.teams.get(1).slots.get(2).race).toBe('t')

    lobby = Lobbies.setRace(lobby, 1, 1, 'r')
    expect(lobby.teams.get(1).slots.get(0).race).toBe('r')
    expect(lobby.teams.get(1).slots.get(1).race).toBe('r')
    expect(lobby.teams.get(1).slots.get(2).race).toBe('r')
  })
})

const UMS_MAP_1 = {
  mapData: {
    umsForces: [
      {
        name: 'Force Player',
        teamId: 1,
        players: [
          { id: 0, race: 'z', typeId: 6, computer: false },
          { id: 1, race: 'z', typeId: 6, computer: false },
          { id: 2, race: 'z', typeId: 6, computer: false },
          { id: 3, race: 'z', typeId: 6, computer: false },
          { id: 4, race: 'z', typeId: 6, computer: false },
          { id: 5, race: 'z', typeId: 6, computer: false },
        ],
      },
      {
        name: 'Force Computer',
        teamId: 2,
        players: [{ id: 7, race: 'z', typeId: 5, computer: true }],
      },
      {
        name: 'Force Computer',
        teamId: 3,
        players: [{ id: 6, race: 'z', typeId: 5, computer: true }],
      },
    ],
  },
}
const UMS_MAP_2 = {
  mapData: {
    umsForces: [
      {
        name: 'tappavat',
        teamId: 1,
        players: [{ id: 1, race: 't', typeId: 6, computer: false }],
      },
      {
        name: 'tapettavat',
        teamId: 2,
        players: [
          { id: 0, race: 't', typeId: 5, computer: true },
          { id: 3, race: 'z', typeId: 5, computer: true },
          { id: 4, race: 'z', typeId: 5, computer: true },
          { id: 5, race: 'z', typeId: 5, computer: true },
          { id: 6, race: 't', typeId: 5, computer: true },
          { id: 7, race: 'z', typeId: 5, computer: true },
        ],
      },
      {
        name: 'portitossi',
        teamId: 4,
        players: [{ id: 2, race: 'p', typeId: 5, computer: true }],
      },
    ],
  },
}
const UMS_MAP_3 = {
  mapData: {
    umsForces: [
      {
        name: 'Players',
        teamId: 1,
        players: [
          { id: 0, race: 'any', typeId: 6, computer: false },
          { id: 1, race: 'any', typeId: 6, computer: false },
        ],
      },
      {
        name: 'Observers',
        teamId: 2,
        players: [
          { id: 2, race: 'p', typeId: 6, computer: false },
          { id: 3, race: 't', typeId: 6, computer: false },
        ],
      },
    ],
  },
}
const UMS_MAP_4 = {
  mapData: {
    umsForces: [
      {
        name: 'Team I',
        teamId: 1,
        players: [
          { id: 0, race: 't', typeId: 6, computer: false },
          { id: 1, race: 't', typeId: 6, computer: false },
          { id: 2, race: 't', typeId: 6, computer: false },
        ],
      },
      {
        name: 'Team II',
        teamId: 2,
        players: [
          { id: 3, race: 't', typeId: 6, computer: false },
          { id: 4, race: 't', typeId: 6, computer: false },
          { id: 5, race: 't', typeId: 6, computer: false },
        ],
      },
      {
        name: 'Map by Cygnus',
        teamId: 3,
        players: [{ id: 6, race: 't', typeId: 7, computer: true }],
      },
      {
        name: 'Force 4',
        teamId: 4,
        players: [{ id: 7, race: 't', typeId: 7, computer: true }],
      },
    ],
  },
}
const UMS_LOBBY_1 = Lobbies.create('Sunken Defence', UMS_MAP_1, 'ums', 0, 8, 'Slayers`Boxer', 27)
const UMS_LOBBY_2 = Lobbies.create('tappavat', UMS_MAP_2, 'ums', 0, 8, 'Slayers`Boxer', 27)
const UMS_LOBBY_3 = Lobbies.create('Accipiter', UMS_MAP_3, 'ums', 0, 4, 'Slayers`Boxer', 27)
const UMS_LOBBY_4 = Lobbies.create('Team Micro', UMS_MAP_4, 'ums', 0, 8, 'Slayers`Boxer', 27)

const evaluateUmsLobby = (lobby, teamCount, humanSlotsCount, opposingSides, host) => {
  expect(lobby.teams).toHaveProperty('size', teamCount)
  expect(humanSlotCount(lobby)).toBe(humanSlotsCount)
  expect(hasOpposingSides(lobby)).toBe(opposingSides)
  expect(host).toEqual(lobby.host)
}

const evaluateUmsTeam = (team, teamId, slotsCount, hiddenSlotsCount) => {
  expect(team.teamId).toBe(teamId)
  expect(team.slots).toHaveProperty('size', slotsCount)
  expect(team.hiddenSlots).toHaveProperty('size', hiddenSlotsCount)
}

const evaluateUmsSlot = (slot, type, name, race, hasForcedRace, playerId) => {
  expect(slot.type).toBe(type)
  expect(slot.name).toBe(name)
  expect(slot.race).toBe(race)
  expect(slot.hasForcedRace).toBe(hasForcedRace)
  expect(slot.playerId).toBe(playerId)
}

describe('Lobbies - Use map settings', () => {
  test('should create the lobby correctly', () => {
    const l1 = UMS_LOBBY_1
    let team1 = l1.teams.get(0)
    let team2 = l1.teams.get(1)
    let team3 = l1.teams.get(2)
    evaluateUmsLobby(l1, 3, 1, true, team1.slots.get(0))
    evaluateUmsTeam(team1, 1, 6, 0)
    evaluateUmsTeam(team2, 2, 1, 0)
    evaluateUmsTeam(team3, 3, 1, 0)
    evaluateUmsSlot(team1.slots.get(0), 'human', 'Slayers`Boxer', 'z', true, 0)
    evaluateUmsSlot(team1.slots.get(1), 'open', 'Open', 'z', true, 1)
    evaluateUmsSlot(team1.slots.get(2), 'open', 'Open', 'z', true, 2)
    evaluateUmsSlot(team1.slots.get(3), 'open', 'Open', 'z', true, 3)
    evaluateUmsSlot(team1.slots.get(4), 'open', 'Open', 'z', true, 4)
    evaluateUmsSlot(team1.slots.get(5), 'open', 'Open', 'z', true, 5)
    evaluateUmsSlot(team2.slots.get(0), 'umsComputer', 'Computer', 'z', true, 7)
    evaluateUmsSlot(team3.slots.get(0), 'umsComputer', 'Computer', 'z', true, 6)

    const l2 = UMS_LOBBY_2
    team1 = l2.teams.get(0)
    team2 = l2.teams.get(1)
    team3 = l2.teams.get(2)
    evaluateUmsLobby(l2, 3, 1, true, team1.slots.get(0))
    evaluateUmsTeam(team1, 1, 1, 0)
    evaluateUmsTeam(team2, 2, 6, 0)
    evaluateUmsTeam(team3, 4, 1, 0)
    evaluateUmsSlot(team1.slots.get(0), 'human', 'Slayers`Boxer', 't', true, 1)
    evaluateUmsSlot(team2.slots.get(0), 'umsComputer', 'Computer', 't', true, 0)
    evaluateUmsSlot(team2.slots.get(1), 'umsComputer', 'Computer', 'z', true, 3)
    evaluateUmsSlot(team2.slots.get(2), 'umsComputer', 'Computer', 'z', true, 4)
    evaluateUmsSlot(team2.slots.get(3), 'umsComputer', 'Computer', 'z', true, 5)
    evaluateUmsSlot(team2.slots.get(4), 'umsComputer', 'Computer', 't', true, 6)
    evaluateUmsSlot(team2.slots.get(5), 'umsComputer', 'Computer', 'z', true, 7)
    evaluateUmsSlot(team3.slots.get(0), 'umsComputer', 'Computer', 'p', true, 2)

    const l3 = UMS_LOBBY_3
    team1 = l3.teams.get(0)
    team2 = l3.teams.get(1)
    evaluateUmsLobby(l3, 2, 1, false, team1.slots.get(0))
    evaluateUmsTeam(team1, 1, 2, 0)
    evaluateUmsTeam(team2, 2, 2, 0)
    evaluateUmsSlot(team1.slots.get(0), 'human', 'Slayers`Boxer', 'r', false, 0)
    evaluateUmsSlot(team1.slots.get(1), 'open', 'Open', 'r', false, 1)
    evaluateUmsSlot(team2.slots.get(0), 'open', 'Open', 'p', true, 2)
    evaluateUmsSlot(team2.slots.get(1), 'open', 'Open', 't', true, 3)

    const l4 = UMS_LOBBY_4
    team1 = l4.teams.get(0)
    team2 = l4.teams.get(1)
    team3 = l4.teams.get(2)
    const team4 = l4.teams.get(3)
    evaluateUmsLobby(l4, 4, 1, false, team1.slots.get(0))
    evaluateUmsTeam(team1, 1, 3, 0)
    evaluateUmsTeam(team2, 2, 3, 0)
    evaluateUmsTeam(team3, 3, 0, 1)
    evaluateUmsTeam(team4, 4, 0, 1)
    evaluateUmsSlot(team1.slots.get(0), 'human', 'Slayers`Boxer', 't', true, 0)
    evaluateUmsSlot(team1.slots.get(1), 'open', 'Open', 't', true, 1)
    evaluateUmsSlot(team1.slots.get(2), 'open', 'Open', 't', true, 2)
    evaluateUmsSlot(team2.slots.get(0), 'open', 'Open', 't', true, 3)
    evaluateUmsSlot(team2.slots.get(1), 'open', 'Open', 't', true, 4)
    evaluateUmsSlot(team2.slots.get(2), 'open', 'Open', 't', true, 5)
    evaluateUmsSlot(team3.hiddenSlots.get(0), 'umsComputer', 'Computer', 't', true, 6)
    evaluateUmsSlot(team4.hiddenSlots.get(0), 'umsComputer', 'Computer', 't', true, 7)
  })

  test('should support removing players', () => {
    const babo = Slots.createHuman('dronebabo', 1, 'z', true, 1)
    let lobby = Lobbies.addPlayer(UMS_LOBBY_1, 0, 1, babo)

    let team1 = lobby.teams.get(0)
    evaluateUmsLobby(lobby, 3, 2, true, team1.slots.get(0))
    evaluateUmsSlot(team1.slots.get(1), 'human', 'dronebabo', 'z', true, 1)

    lobby = Lobbies.removePlayer(lobby, 0, 1, team1.slots.get(1))
    team1 = lobby.teams.get(0)
    evaluateUmsLobby(lobby, 3, 1, true, team1.slots.get(0))
    evaluateUmsSlot(team1.slots.get(1), 'open', 'Open', 'z', true, 1)
  })

  test('should support moving players between slots', () => {
    let l1 = UMS_LOBBY_1
    let team1 = l1.teams.get(0)
    let team2 = l1.teams.get(1)
    let team3 = l1.teams.get(2)
    evaluateUmsLobby(l1, 3, 1, true, team1.slots.get(0))
    evaluateUmsTeam(team1, 1, 6, 0)
    evaluateUmsTeam(team2, 2, 1, 0)
    evaluateUmsTeam(team3, 3, 1, 0)
    evaluateUmsSlot(team1.slots.get(0), 'human', 'Slayers`Boxer', 'z', true, 0)
    evaluateUmsSlot(team1.slots.get(1), 'open', 'Open', 'z', true, 1)
    evaluateUmsSlot(team1.slots.get(2), 'open', 'Open', 'z', true, 2)
    evaluateUmsSlot(team1.slots.get(3), 'open', 'Open', 'z', true, 3)
    evaluateUmsSlot(team1.slots.get(4), 'open', 'Open', 'z', true, 4)
    evaluateUmsSlot(team1.slots.get(5), 'open', 'Open', 'z', true, 5)
    evaluateUmsSlot(team2.slots.get(0), 'umsComputer', 'Computer', 'z', true, 7)
    evaluateUmsSlot(team3.slots.get(0), 'umsComputer', 'Computer', 'z', true, 6)

    l1 = Lobbies.movePlayerToSlot(l1, 0, 0, 0, 1)
    team1 = l1.teams.get(0)
    team2 = l1.teams.get(1)
    team3 = l1.teams.get(2)
    evaluateUmsLobby(l1, 3, 1, true, team1.slots.get(1))
    evaluateUmsTeam(team1, 1, 6, 0)
    evaluateUmsTeam(team2, 2, 1, 0)
    evaluateUmsTeam(team3, 3, 1, 0)
    evaluateUmsSlot(team1.slots.get(0), 'open', 'Open', 'z', true, 0)
    evaluateUmsSlot(team1.slots.get(1), 'human', 'Slayers`Boxer', 'z', true, 1)
    evaluateUmsSlot(team1.slots.get(2), 'open', 'Open', 'z', true, 2)
    evaluateUmsSlot(team1.slots.get(3), 'open', 'Open', 'z', true, 3)
    evaluateUmsSlot(team1.slots.get(4), 'open', 'Open', 'z', true, 4)
    evaluateUmsSlot(team1.slots.get(5), 'open', 'Open', 'z', true, 5)
    evaluateUmsSlot(team2.slots.get(0), 'umsComputer', 'Computer', 'z', true, 7)
    evaluateUmsSlot(team3.slots.get(0), 'umsComputer', 'Computer', 'z', true, 6)

    let l3 = UMS_LOBBY_3
    team1 = l3.teams.get(0)
    team2 = l3.teams.get(1)
    evaluateUmsLobby(l3, 2, 1, false, team1.slots.get(0))
    evaluateUmsTeam(team1, 1, 2, 0)
    evaluateUmsTeam(team2, 2, 2, 0)
    evaluateUmsSlot(team1.slots.get(0), 'human', 'Slayers`Boxer', 'r', false, 0)
    evaluateUmsSlot(team1.slots.get(1), 'open', 'Open', 'r', false, 1)
    evaluateUmsSlot(team2.slots.get(0), 'open', 'Open', 'p', true, 2)
    evaluateUmsSlot(team2.slots.get(1), 'open', 'Open', 't', true, 3)

    l3 = Lobbies.movePlayerToSlot(l3, 0, 0, 0, 1)
    team1 = l3.teams.get(0)
    team2 = l3.teams.get(1)
    evaluateUmsLobby(l3, 2, 1, false, team1.slots.get(1))
    evaluateUmsTeam(team1, 1, 2, 0)
    evaluateUmsTeam(team2, 2, 2, 0)
    evaluateUmsSlot(team1.slots.get(0), 'open', 'Open', 'r', false, 0)
    evaluateUmsSlot(team1.slots.get(1), 'human', 'Slayers`Boxer', 'r', false, 1)
    evaluateUmsSlot(team2.slots.get(0), 'open', 'Open', 'p', true, 2)
    evaluateUmsSlot(team2.slots.get(1), 'open', 'Open', 't', true, 3)
  })

  test('should support closing an open slot', () => {
    let l1 = UMS_LOBBY_1
    let team1 = l1.teams.get(0)
    let team2 = l1.teams.get(1)
    let team3 = l1.teams.get(2)
    evaluateUmsLobby(l1, 3, 1, true, team1.slots.get(0))
    evaluateUmsTeam(team1, 1, 6, 0)
    evaluateUmsTeam(team2, 2, 1, 0)
    evaluateUmsTeam(team3, 3, 1, 0)
    evaluateUmsSlot(team1.slots.get(0), 'human', 'Slayers`Boxer', 'z', true, 0)
    evaluateUmsSlot(team1.slots.get(1), 'open', 'Open', 'z', true, 1)
    evaluateUmsSlot(team1.slots.get(2), 'open', 'Open', 'z', true, 2)
    evaluateUmsSlot(team1.slots.get(3), 'open', 'Open', 'z', true, 3)
    evaluateUmsSlot(team1.slots.get(4), 'open', 'Open', 'z', true, 4)
    evaluateUmsSlot(team1.slots.get(5), 'open', 'Open', 'z', true, 5)
    evaluateUmsSlot(team2.slots.get(0), 'umsComputer', 'Computer', 'z', true, 7)
    evaluateUmsSlot(team3.slots.get(0), 'umsComputer', 'Computer', 'z', true, 6)

    l1 = Lobbies.closeSlot(l1, 0, 1)
    team1 = l1.teams.get(0)
    team2 = l1.teams.get(1)
    team3 = l1.teams.get(2)
    evaluateUmsLobby(l1, 3, 1, true, team1.slots.get(0))
    evaluateUmsTeam(team1, 1, 6, 0)
    evaluateUmsTeam(team2, 2, 1, 0)
    evaluateUmsTeam(team3, 3, 1, 0)
    evaluateUmsSlot(team1.slots.get(0), 'human', 'Slayers`Boxer', 'z', true, 0)
    evaluateUmsSlot(team1.slots.get(1), 'closed', 'Closed', 'z', true, 1)
    evaluateUmsSlot(team1.slots.get(2), 'open', 'Open', 'z', true, 2)
    evaluateUmsSlot(team1.slots.get(3), 'open', 'Open', 'z', true, 3)
    evaluateUmsSlot(team1.slots.get(4), 'open', 'Open', 'z', true, 4)
    evaluateUmsSlot(team1.slots.get(5), 'open', 'Open', 'z', true, 5)
    evaluateUmsSlot(team2.slots.get(0), 'umsComputer', 'Computer', 'z', true, 7)
    evaluateUmsSlot(team3.slots.get(0), 'umsComputer', 'Computer', 'z', true, 6)
  })

  test('should support opening a closed slot', () => {
    let l1 = UMS_LOBBY_1
    let team1 = l1.teams.get(0)
    let team2 = l1.teams.get(1)
    let team3 = l1.teams.get(2)
    evaluateUmsLobby(l1, 3, 1, true, team1.slots.get(0))
    evaluateUmsTeam(team1, 1, 6, 0)
    evaluateUmsTeam(team2, 2, 1, 0)
    evaluateUmsTeam(team3, 3, 1, 0)
    evaluateUmsSlot(team1.slots.get(0), 'human', 'Slayers`Boxer', 'z', true, 0)
    evaluateUmsSlot(team1.slots.get(1), 'open', 'Open', 'z', true, 1)
    evaluateUmsSlot(team1.slots.get(2), 'open', 'Open', 'z', true, 2)
    evaluateUmsSlot(team1.slots.get(3), 'open', 'Open', 'z', true, 3)
    evaluateUmsSlot(team1.slots.get(4), 'open', 'Open', 'z', true, 4)
    evaluateUmsSlot(team1.slots.get(5), 'open', 'Open', 'z', true, 5)
    evaluateUmsSlot(team2.slots.get(0), 'umsComputer', 'Computer', 'z', true, 7)
    evaluateUmsSlot(team3.slots.get(0), 'umsComputer', 'Computer', 'z', true, 6)

    l1 = Lobbies.closeSlot(l1, 0, 1)
    team1 = l1.teams.get(0)
    team2 = l1.teams.get(1)
    team3 = l1.teams.get(2)
    evaluateUmsLobby(l1, 3, 1, true, team1.slots.get(0))
    evaluateUmsTeam(team1, 1, 6, 0)
    evaluateUmsTeam(team2, 2, 1, 0)
    evaluateUmsTeam(team3, 3, 1, 0)
    evaluateUmsSlot(team1.slots.get(0), 'human', 'Slayers`Boxer', 'z', true, 0)
    evaluateUmsSlot(team1.slots.get(1), 'closed', 'Closed', 'z', true, 1)
    evaluateUmsSlot(team1.slots.get(2), 'open', 'Open', 'z', true, 2)
    evaluateUmsSlot(team1.slots.get(3), 'open', 'Open', 'z', true, 3)
    evaluateUmsSlot(team1.slots.get(4), 'open', 'Open', 'z', true, 4)
    evaluateUmsSlot(team1.slots.get(5), 'open', 'Open', 'z', true, 5)
    evaluateUmsSlot(team2.slots.get(0), 'umsComputer', 'Computer', 'z', true, 7)
    evaluateUmsSlot(team3.slots.get(0), 'umsComputer', 'Computer', 'z', true, 6)

    l1 = Lobbies.openSlot(l1, 0, 1)
    team1 = l1.teams.get(0)
    team2 = l1.teams.get(1)
    team3 = l1.teams.get(2)
    evaluateUmsLobby(l1, 3, 1, true, team1.slots.get(0))
    evaluateUmsTeam(team1, 1, 6, 0)
    evaluateUmsTeam(team2, 2, 1, 0)
    evaluateUmsTeam(team3, 3, 1, 0)
    evaluateUmsSlot(team1.slots.get(0), 'human', 'Slayers`Boxer', 'z', true, 0)
    evaluateUmsSlot(team1.slots.get(1), 'open', 'Open', 'z', true, 1)
    evaluateUmsSlot(team1.slots.get(2), 'open', 'Open', 'z', true, 2)
    evaluateUmsSlot(team1.slots.get(3), 'open', 'Open', 'z', true, 3)
    evaluateUmsSlot(team1.slots.get(4), 'open', 'Open', 'z', true, 4)
    evaluateUmsSlot(team1.slots.get(5), 'open', 'Open', 'z', true, 5)
    evaluateUmsSlot(team2.slots.get(0), 'umsComputer', 'Computer', 'z', true, 7)
    evaluateUmsSlot(team3.slots.get(0), 'umsComputer', 'Computer', 'z', true, 6)
  })
})
