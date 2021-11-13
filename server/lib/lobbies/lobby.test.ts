import { GameType } from '../../../common/games/configuration'
import {
  findSlotById,
  findSlotByName,
  hasOpposingSides,
  humanSlotCount,
  Lobby,
  Team,
} from '../../../common/lobbies'
import { createComputer, createHuman, Slot } from '../../../common/lobbies/slot'
import { MapInfo, MapVisibility, Tileset } from '../../../common/maps'
import { RaceChar } from '../../../common/races'
import { makeSbUserId } from '../../../common/users/user-info'
import {
  addPlayer,
  closeSlot,
  createLobby,
  findAvailableSlot,
  makeObserver,
  movePlayerToSlot,
  openSlot,
  removeObserver,
  removePlayer,
  setRace,
  toSummaryJson,
} from './lobby'

const BigGameHunters: MapInfo = {
  id: 'big-game-hunters',
  hash: 'deadbeef',
  name: 'Big Game Hunters',
  description: '',
  uploadedBy: {
    id: 1,
    name: 'someperson',
  },
  uploadDate: new Date(0),
  visibility: MapVisibility.Official,
  mapData: {
    format: 'scm',
    tileset: Tileset.Jungle,
    originalName: 'Big Game Hunters',
    originalDescription: '',
    slots: 8,
    umsSlots: 8,
    umsForces: [{ name: 'team', teamId: 0, players: [] }],
    width: 256,
    height: 256,
    isEud: false,
    parserVersion: 1,
  },
  imageVersion: 1,
  isFavorited: false,
}

const BOXER_LOBBY = createLobby(
  '5v3 Comp Stomp Pros Only',
  BigGameHunters,
  GameType.Melee,
  0,
  4,
  'Slayers`Boxer',
  makeSbUserId(27),
  'r',
  false,
)

const BOXER_LOBBY_WITH_OBSERVERS = createLobby(
  '5v3 Comp Stomp Pros Only',
  BigGameHunters,
  GameType.Melee,
  0,
  6,
  'Slayers`Boxer',
  makeSbUserId(27),
  'r',
  true,
)

const evaluateMeleeLobby = (lobby: Lobby, teamSize: number, slotCount = 4) => {
  expect(lobby.teams).toHaveProperty('size', teamSize)
  const team = lobby.teams.get(0)!
  expect(team.slots).toHaveProperty('size', slotCount)
  expect(humanSlotCount(lobby)).toBe(1)
  expect(hasOpposingSides(lobby)).toBe(false)
  const player = team.slots.get(0)!
  expect(player.type).toBe('human')
  expect(player.name).toBe('Slayers`Boxer')
  expect(player.race).toBe('r')
  expect(player).toEqual(lobby.host)
  expect(team.slots.get(1)!.type).toBe('open')
  expect(team.slots.get(2)!.type).toBe('open')
  expect(team.slots.get(3)!.type).toBe('open')
}

const evaluateSummarizedJson = (lobby: Lobby, openSlotCount: number) => {
  const json = JSON.stringify(toSummaryJson(lobby))
  const parsed = JSON.parse(json)

  const id = lobby.host.id
  expect(parsed).toEqual({
    name: '5v3 Comp Stomp Pros Only',
    // TODO(tec27): Probably we should numerically convert this Date like in other places, or just
    // move the MapInfo out of this structure? Dunno
    map: {
      ...BigGameHunters,
      uploadDate: BigGameHunters.uploadDate.toISOString(),
    },
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
    evaluateMeleeLobby(l, 2, 6)
    let observers = l.teams.get(1)!
    expect(observers.slots).toHaveProperty('size', 2)
    expect(observers.slots.get(0)!.type).toBe('closed')
    expect(observers.slots.get(1)!.type).toBe('closed')

    l = openSlot(l, 1, 0)
    observers = l.teams.get(1)!
    expect(observers.slots.get(0)!.type).toBe('open')
    expect(observers.slots.get(1)!.type).toBe('closed')
  })

  test('should support summarized JSON serialization', () => {
    evaluateSummarizedJson(BOXER_LOBBY, 3)
    evaluateSummarizedJson(BOXER_LOBBY_WITH_OBSERVERS, 5)
    evaluateSummarizedJson(openSlot(BOXER_LOBBY_WITH_OBSERVERS, 1, 0), 6)
  })

  test('should find available slot', () => {
    const [t1, s1] = findAvailableSlot(BOXER_LOBBY)
    expect(t1).toBe(0)
    expect(s1).toBe(1)

    const fullLobby = createLobby(
      'Full',
      BigGameHunters,
      GameType.Melee,
      0,
      1,
      'pachi',
      makeSbUserId(2),
      'r',
      true,
    )
    const [t2, s2] = findAvailableSlot(fullLobby)
    expect(t2).toBe(-1)
    expect(s2).toBe(-1)

    let fullLobbyWithObservers = createLobby(
      'Full',
      BigGameHunters,
      GameType.Melee,
      0,
      1,
      'pachi',
      makeSbUserId(2),
      'r',
      true,
    )
    const [t3, s3] = findAvailableSlot(fullLobbyWithObservers)
    expect(t3).toBe(-1)
    expect(s3).toBe(-1)
    fullLobbyWithObservers = openSlot(fullLobbyWithObservers, 1, 0)
    const [t4, s4] = findAvailableSlot(fullLobbyWithObservers)
    expect(t4).toBe(1)
    expect(s4).toBe(0)
  })

  test('should support adding players', () => {
    const babo = createHuman('dronebabo', makeSbUserId(1), 'z')
    const pachi = createHuman('pachi', makeSbUserId(2), 'p')

    const orig = BOXER_LOBBY
    let lobby = orig

    const [t1, s1] = findAvailableSlot(lobby)
    lobby = addPlayer(lobby, t1, s1, babo)
    expect(lobby).not.toEqual(orig)
    const [, , p1] = findSlotById(lobby, babo.id)
    expect(p1).toEqual(babo)
    expect(humanSlotCount(lobby)).toBe(2)
    expect(hasOpposingSides(lobby)).toBe(true)

    const [t2, s2] = findAvailableSlot(lobby)
    lobby = addPlayer(lobby, t2, s2, pachi)
    expect(lobby).not.toEqual(orig)
    const [, , p2] = findSlotById(lobby, pachi.id)
    expect(p2).toEqual(pachi)
    expect(humanSlotCount(lobby)).toBe(3)
  })

  test('should support removing players', () => {
    const orig = BOXER_LOBBY
    const [t1, s1, p1] = findSlotByName(orig, 'asdf')
    let lobby = removePlayer(orig, t1!, s1!, p1!)!
    expect(lobby).toEqual(orig)

    const babo = createHuman('dronebabo', makeSbUserId(1), 'z')
    const [t2, s2] = findAvailableSlot(lobby)
    lobby = addPlayer(lobby, t2, s2, babo)
    const beforeRemoval = lobby
    lobby = removePlayer(lobby, t2, s2, babo)!

    expect(lobby).not.toEqual(beforeRemoval)
    expect(humanSlotCount(lobby)).toBe(1)
    expect(lobby.teams.get(t2)!.slots.get(s2)!.type).toBe('open')

    const [t3, s3, host] = findSlotByName(lobby, lobby.host.name)
    lobby = removePlayer(lobby, t3!, s3!, host!)!
    expect(lobby).toBeUndefined()
  })

  test('should support setting the race of a player', () => {
    const computer = createComputer('t')
    const [t1, s1] = findAvailableSlot(BOXER_LOBBY)
    let lobby = addPlayer(BOXER_LOBBY, t1, s1, computer)

    lobby = setRace(lobby, t1, s1, 'z')

    expect(lobby.teams.get(t1)!.slots.get(s1)!.race).toBe('z')
  })

  test('should support finding players by name', () => {
    const computer = createComputer('p')
    const [t1, s1] = findAvailableSlot(BOXER_LOBBY)
    const lobby = addPlayer(BOXER_LOBBY, t1, s1, computer)

    const [, , p1] = findSlotByName(lobby, 'asdf')
    expect(p1).toBeUndefined()

    const [, , p2] = findSlotByName(lobby, computer.name)
    expect(p2).toBeUndefined()

    const [, , p3] = findSlotByName(lobby, 'Slayers`Boxer')
    expect(p3).toBeDefined()
    expect(p3!.type).toBe('human')
    expect(p3!.name).toBe('Slayers`Boxer')
  })

  test('should support finding players by id', () => {
    const computer = createComputer('p')
    const [t1, s1] = findAvailableSlot(BOXER_LOBBY)
    const lobby = addPlayer(BOXER_LOBBY, t1, s1, computer)

    const [, , p1] = findSlotById(lobby, '10')
    expect(p1).toBeUndefined()

    const [, , p2] = findSlotById(lobby, computer.id)
    expect(p2).toBeDefined()
    expect(p2!.type).toBe('computer')
    expect(p2!.name).toBe('Computer')
    expect(p2!.race).toBe('p')
  })

  test('should close the lobby if only computers are left', () => {
    const computer = createComputer('p')
    const [t1, s1] = findAvailableSlot(BOXER_LOBBY)
    let lobby = addPlayer(BOXER_LOBBY, t1, s1, computer)

    const [t2, s2, p1] = findSlotById(lobby, lobby.host.id)
    lobby = removePlayer(lobby, t2!, s2!, p1!)!

    expect(lobby).toBeUndefined()
  })

  test('should support transferring host status to the next oldest player on host removal', () => {
    const computer = createComputer('p')
    const babo = createHuman('dronebabo', makeSbUserId(1), 'z')
    const pachi = createHuman('pachi', makeSbUserId(2), 't')
    const [t1, s1] = findAvailableSlot(BOXER_LOBBY)
    let lobby = addPlayer(BOXER_LOBBY, t1, s1, computer)
    const [t2, s2] = findAvailableSlot(lobby)
    lobby = addPlayer(lobby, t2, s2, babo)
    const [t3, s3] = findAvailableSlot(lobby)
    lobby = addPlayer(lobby, t3, s3, pachi)

    const [t4, s4, p1] = findSlotById(lobby, lobby.host.id)
    lobby = removePlayer(lobby, t4!, s4!, p1!)!

    expect(lobby.host).toBe(babo)
  })

  test('should support moving players between slots', () => {
    const babo = createHuman('dronebabo', makeSbUserId(1), 'z')
    const [t1, s1] = findAvailableSlot(BOXER_LOBBY)
    let lobby = addPlayer(BOXER_LOBBY, t1, s1, babo)
    lobby = movePlayerToSlot(lobby, t1, s1, 0, 3)

    expect(humanSlotCount(lobby)).toBe(2)
    expect(lobby.teams.get(0)!.slots.get(3)).toBe(babo)
    expect(lobby.teams.get(t1)!.slots.get(s1)!.type).toBe('open')
  })

  test('should support closing an open slot', () => {
    let lobby = BOXER_LOBBY
    expect(lobby.teams.get(0)!.slots.get(0)).toEqual(lobby.host)
    expect(lobby.teams.get(0)!.slots.get(1)!.type).toBe('open')
    expect(lobby.teams.get(0)!.slots.get(2)!.type).toBe('open')
    expect(lobby.teams.get(0)!.slots.get(3)!.type).toBe('open')

    lobby = closeSlot(lobby, 0, 1)
    expect(lobby.teams.get(0)!.slots.get(0)).toEqual(lobby.host)
    expect(lobby.teams.get(0)!.slots.get(1)!.type).toBe('closed')
    expect(lobby.teams.get(0)!.slots.get(2)!.type).toBe('open')
    expect(lobby.teams.get(0)!.slots.get(3)!.type).toBe('open')

    expect(() => closeSlot(lobby, 0, 0)).toThrow()
    expect(() => closeSlot(lobby, 0, 1)).toThrow()
  })

  test('should support opening a closed slot', () => {
    let lobby = BOXER_LOBBY
    expect(lobby.teams.get(0)!.slots.get(0)).toEqual(lobby.host)
    expect(lobby.teams.get(0)!.slots.get(1)!.type).toBe('open')
    expect(lobby.teams.get(0)!.slots.get(2)!.type).toBe('open')
    expect(lobby.teams.get(0)!.slots.get(3)!.type).toBe('open')

    lobby = closeSlot(lobby, 0, 1)
    expect(lobby.teams.get(0)!.slots.get(0)).toEqual(lobby.host)
    expect(lobby.teams.get(0)!.slots.get(1)!.type).toBe('closed')
    expect(lobby.teams.get(0)!.slots.get(2)!.type).toBe('open')
    expect(lobby.teams.get(0)!.slots.get(3)!.type).toBe('open')

    lobby = openSlot(lobby, 0, 1)
    expect(lobby.teams.get(0)!.slots.get(0)).toEqual(lobby.host)
    expect(lobby.teams.get(0)!.slots.get(1)!.type).toBe('open')
    expect(lobby.teams.get(0)!.slots.get(2)!.type).toBe('open')
    expect(lobby.teams.get(0)!.slots.get(3)!.type).toBe('open')

    expect(() => openSlot(lobby, 0, 0)).toThrow()
    expect(() => openSlot(lobby, 0, 1)).toThrow()
  })

  test('should support adding observer slots', () => {
    let lobby = BOXER_LOBBY_WITH_OBSERVERS
    let players = lobby.teams.get(0)!
    let observers = lobby.teams.get(1)!
    expect(players.slots).toHaveProperty('size', 6)
    expect(observers.slots).toHaveProperty('size', 2)

    lobby = makeObserver(lobby, 0, 0)
    players = lobby.teams.get(0)!
    observers = lobby.teams.get(1)!
    expect(players.slots).toHaveProperty('size', 5)
    expect(observers.slots).toHaveProperty('size', 3)
    expect(players.slots.get(0)!.type).toBe('open')
    expect(players.slots.get(1)!.type).toBe('open')
    expect(players.slots.get(2)!.type).toBe('open')
    expect(observers.slots.get(2)!.id).toBe(lobby.host.id)

    const babo = createHuman('dronebabo', makeSbUserId(1), 'z')
    const pachi = createHuman('pachi', makeSbUserId(2), 'p')
    const computer = createComputer('p')
    lobby = addPlayer(lobby, 0, 0, babo)
    lobby = addPlayer(lobby, 0, 1, pachi)
    lobby = addPlayer(lobby, 0, 2, computer)
    expect(() => makeObserver(lobby, 0, 2)).toThrow()
    lobby = makeObserver(lobby, 0, 1)
    expect(() => makeObserver(lobby, 0, 0)).toThrow()

    players = lobby.teams.get(0)!
    observers = lobby.teams.get(1)!
    expect(players.slots).toHaveProperty('size', 4)
    expect(observers.slots).toHaveProperty('size', 4)
    expect(players.slots.get(0)!.type).toBe('human')
    expect(players.slots.get(0)!.name).toBe('dronebabo')
    expect(players.slots.get(1)!.type).toBe('computer')
    expect(observers.slots.get(0)!.type).toBe('closed')
    expect(observers.slots.get(1)!.type).toBe('closed')
    expect(observers.slots.get(2)!.name).toBe('Slayers`Boxer')
    expect(observers.slots.get(3)!.name).toBe('pachi')

    expect(() => makeObserver(lobby, 0, 0)).toThrow()
  })

  test('should support removing observer slots', () => {
    let lobby = BOXER_LOBBY_WITH_OBSERVERS

    const babo = createHuman('dronebabo', makeSbUserId(1), 'z')
    lobby = addPlayer(lobby, 0, 1, babo)

    let players = lobby.teams.get(0)!
    let observers = lobby.teams.get(1)!
    expect(players.slots).toHaveProperty('size', 6)
    expect(observers.slots).toHaveProperty('size', 2)
    expect(() => removeObserver(lobby, 0)).toThrow()

    // Move boxer and open slot to obs
    lobby = makeObserver(lobby, 0, 0)
    lobby = makeObserver(lobby, 0, 1)
    // Move closed and boxer back
    lobby = removeObserver(lobby, 0)
    lobby = removeObserver(lobby, 1)
    players = lobby.teams.get(0)!
    observers = lobby.teams.get(1)!

    expect(players.slots).toHaveProperty('size', 6)
    expect(observers.slots).toHaveProperty('size', 2)
    expect(() => removeObserver(lobby, 0)).toThrow()
    expect(players.slots.get(0)!.type).toBe('human')
    expect(players.slots.get(1)!.type).toBe('open')
    expect(players.slots.get(2)!.type).toBe('open')
    expect(players.slots.get(3)!.type).toBe('open')
    expect(players.slots.get(4)!.type).toBe('closed')
    expect(players.slots.get(5)!.type).toBe('human')
    expect(players.slots.get(5)!.name).toBe('Slayers`Boxer')

    expect(observers.slots.get(0)!.type).toBe('closed')
    expect(observers.slots.get(1)!.type).toBe('open')
  })
})

const TEAM_LOBBY = createLobby(
  '2v6 BGH',
  BigGameHunters,
  GameType.TopVsBottom,
  2,
  8,
  'Slayers`Boxer',
  makeSbUserId(27),
  'r',
  false,
)

describe('Lobbies - Top vs bottom', () => {
  test('should create the lobby correctly', () => {
    const l = TEAM_LOBBY
    expect(l.teams).toHaveProperty('size', 2)
    const team1 = l.teams.get(0)!
    expect(team1.slots).toHaveProperty('size', 2)
    const team2 = l.teams.get(1)!
    expect(team2.slots).toHaveProperty('size', 6)
    expect(humanSlotCount(l)).toBe(1)
    expect(hasOpposingSides(l)).toBe(false)
    const player = team1.slots.get(0)!
    expect(player.type).toBe('human')
    expect(player.name).toBe('Slayers`Boxer')
    expect(player.race).toBe('r')
    expect(player).toEqual(l.host)
    expect(team1.slots.get(1)!.type).toBe('open')
    expect(team2.slots.get(0)!.type).toBe('open')
    expect(team2.slots.get(1)!.type).toBe('open')
    expect(team2.slots.get(2)!.type).toBe('open')
    expect(team2.slots.get(3)!.type).toBe('open')
    expect(team2.slots.get(4)!.type).toBe('open')
    expect(team2.slots.get(5)!.type).toBe('open')
  })

  test('should balance teams when adding new players', () => {
    expect(hasOpposingSides(TEAM_LOBBY)).toBe(false)
    const [t1, s1] = findAvailableSlot(TEAM_LOBBY)
    expect(t1).toBe(1)
    expect(s1).toBe(0)
    const babo = createHuman('dronebabo', makeSbUserId(1), 'z')
    let l = addPlayer(TEAM_LOBBY, t1, s1, babo)
    expect(hasOpposingSides(l)).toBe(true)

    const [t2, s2] = findAvailableSlot(l)
    expect(t2).toBe(1)
    expect(s2).toBe(1)
    const pachi = createHuman('pachi', makeSbUserId(2), 't')
    l = addPlayer(l, t2, s2, pachi)

    const [t3, s3] = findAvailableSlot(l)
    expect(t3).toBe(1)
    expect(s3).toBe(2)
    const computer1 = createComputer('p')
    l = addPlayer(l, t3, s3, computer1)

    const [t4, s4] = findAvailableSlot(l)
    expect(t4).toBe(1)
    expect(s4).toBe(3)
    const computer2 = createComputer('z')
    l = addPlayer(l, t4, s4, computer2)

    const [t5, s5] = findAvailableSlot(l)
    expect(t5).toBe(1)
    expect(s5).toBe(4)
    const computer3 = createComputer('z')
    l = addPlayer(l, t5, s5, computer3)

    const [t6, s6] = findAvailableSlot(l)
    expect(t6).toBe(0)
    expect(s6).toBe(1)
    const computer4 = createComputer('z')
    l = addPlayer(l, t6, s6, computer4)

    const [t7, s7] = findAvailableSlot(l)
    expect(t7).toBe(1)
    expect(s7).toBe(5)
    const computer5 = createComputer('z')
    l = addPlayer(l, t7, s7, computer5)

    const [t8, s8] = findAvailableSlot(l)
    expect(t8).toBe(-1)
    expect(s8).toBe(-1)
  })

  test('should support moving players between slots', () => {
    const [t1, s1] = findAvailableSlot(TEAM_LOBBY)
    const babo = createHuman('dronebabo', makeSbUserId(1), 'z')
    let lobby = addPlayer(TEAM_LOBBY, t1, s1, babo)
    lobby = movePlayerToSlot(lobby, t1, s1, 1, 3)

    expect(humanSlotCount(lobby)).toBe(2)
    expect(lobby.teams.get(1)!.slots.get(3)).toBe(babo)
    expect(lobby.teams.get(t1)!.slots.get(s1)!.type).toBe('open')
  })
})

const TEAM_MELEE_2 = createLobby(
  '4v4 Team Melee',
  BigGameHunters,
  GameType.TeamMelee,
  2,
  8,
  'Slayers`Boxer',
  makeSbUserId(27),
  'r',
  false,
)
const TEAM_MELEE_3 = createLobby(
  '3v3v2 Team Melee',
  BigGameHunters,
  GameType.TeamMelee,
  3,
  8,
  'Slayers`Boxer',
  makeSbUserId(27),
  'r',
  false,
)
const TEAM_MELEE_4 = createLobby(
  '2v2v2v2 Team Melee',
  BigGameHunters,
  GameType.TeamMelee,
  4,
  8,
  'Slayers`Boxer',
  makeSbUserId(27),
  'r',
  false,
)

const evaluateControlledSlot = (slot: Slot, type: string, race: RaceChar, controlledBy: string) => {
  expect(slot.type).toBe(type)
  expect(slot.race).toBe(race)
  expect(slot.controlledBy).toBe(controlledBy)
}

describe('Lobbies - Team melee', () => {
  test('should create the lobby correctly', () => {
    const l2 = TEAM_MELEE_2
    expect(l2.teams).toHaveProperty('size', 2)
    let team1 = l2.teams.get(0)!
    expect(team1.slots).toHaveProperty('size', 4)
    let team2 = l2.teams.get(1)!
    expect(team2.slots).toHaveProperty('size', 4)
    expect(humanSlotCount(l2)).toBe(1)
    expect(hasOpposingSides(l2)).toBe(false)
    let player = team1.slots.get(0)!
    expect(player.type).toBe('human')
    expect(player.name).toBe('Slayers`Boxer')
    expect(player.race).toBe('r')
    expect(player).toEqual(l2.host)
    evaluateControlledSlot(team1.slots.get(1)!, 'controlledOpen', player.race, player.id)
    evaluateControlledSlot(team1.slots.get(2)!, 'controlledOpen', player.race, player.id)
    evaluateControlledSlot(team1.slots.get(3)!, 'controlledOpen', player.race, player.id)
    expect(team2.slots.get(0)!.type).toBe('open')
    expect(team2.slots.get(1)!.type).toBe('open')
    expect(team2.slots.get(2)!.type).toBe('open')
    expect(team2.slots.get(3)!.type).toBe('open')

    const l3 = TEAM_MELEE_3
    expect(l3.teams).toHaveProperty('size', 3)
    team1 = l3.teams.get(0)!
    expect(team1.slots).toHaveProperty('size', 3)
    team2 = l3.teams.get(1)!
    expect(team2.slots).toHaveProperty('size', 3)
    let team3 = l3.teams.get(2)!
    expect(team3.slots).toHaveProperty('size', 2)
    expect(humanSlotCount(l3)).toBe(1)
    expect(hasOpposingSides(l3)).toBe(false)
    player = team1.slots.get(0)!
    expect(player.type).toBe('human')
    expect(player.name).toBe('Slayers`Boxer')
    expect(player.race).toBe('r')
    expect(player).toEqual(l3.host)
    evaluateControlledSlot(team1.slots.get(1)!, 'controlledOpen', player.race, player.id)
    evaluateControlledSlot(team1.slots.get(2)!, 'controlledOpen', player.race, player.id)
    expect(team2.slots.get(0)!.type).toBe('open')
    expect(team2.slots.get(1)!.type).toBe('open')
    expect(team2.slots.get(2)!.type).toBe('open')
    expect(team3.slots.get(0)!.type).toBe('open')
    expect(team3.slots.get(1)!.type).toBe('open')

    const l4 = TEAM_MELEE_4
    expect(l4.teams).toHaveProperty('size', 4)
    team1 = l4.teams.get(0)!
    expect(team1.slots).toHaveProperty('size', 2)
    team2 = l4.teams.get(1)!
    expect(team2.slots).toHaveProperty('size', 2)
    team3 = l4.teams.get(2)!
    expect(team3.slots).toHaveProperty('size', 2)
    const team4 = l4.teams.get(3)!
    expect(team4.slots).toHaveProperty('size', 2)
    expect(humanSlotCount(l4)).toBe(1)
    expect(hasOpposingSides(l4)).toBe(false)
    player = team1.slots.get(0)!
    expect(player.type).toBe('human')
    expect(player.name).toBe('Slayers`Boxer')
    expect(player.race).toBe('r')
    expect(player).toEqual(l4.host)
    evaluateControlledSlot(team1.slots.get(1)!, 'controlledOpen', player.race, player.id)
    expect(team2.slots.get(0)!.type).toBe('open')
    expect(team2.slots.get(1)!.type).toBe('open')
    expect(team3.slots.get(0)!.type).toBe('open')
    expect(team3.slots.get(1)!.type).toBe('open')
    expect(team4.slots.get(0)!.type).toBe('open')
    expect(team4.slots.get(1)!.type).toBe('open')
  })

  test('should fill team slots when a player is added to an empty team', () => {
    const babo = createHuman('dronebabo', makeSbUserId(1), 'z')
    const l = addPlayer(TEAM_MELEE_2, 1, 0, babo)
    expect(humanSlotCount(l)).toBe(2)
    expect(hasOpposingSides(l)).toBe(true)
    expect(l.teams.get(1)!.slots.get(0)).toEqual(babo)
    evaluateControlledSlot(l.teams.get(1)!.slots.get(1)!, 'controlledOpen', babo.race, babo.id)
  })

  test('should allow players to join slots that were previously controlled opens', () => {
    expect(TEAM_MELEE_4.teams.get(0)!.slots.get(1)!.type).toBe('controlledOpen')
    const babo = createHuman('dronebabo', makeSbUserId(1), 'z')
    const l = addPlayer(TEAM_MELEE_4, 0, 1, babo)
    expect(humanSlotCount(l)).toBe(2)
    expect(hasOpposingSides(l)).toBe(false)
    expect(l.teams.get(0)!.slots.get(1)).toEqual(babo)
  })

  test('should fill team slots with computers when a computer is added to an empty team', () => {
    const comp = createComputer('z')
    const l = addPlayer(TEAM_MELEE_4, 1, 0, comp)
    expect(humanSlotCount(l)).toBe(1)
    expect(hasOpposingSides(l)).toBe(true)
    expect(l.teams.get(1)!.slots.get(0)).toEqual(comp)
    expect(l.teams.get(1)!.slots.get(1)!.type).toBe('computer')
  })

  test('should balance teams when adding new players', () => {
    expect(hasOpposingSides(TEAM_MELEE_4)).toBe(false)
    const [t1, s1] = findAvailableSlot(TEAM_MELEE_4)
    expect(t1).toBe(1)
    expect(s1).toBe(0)
    const babo = createHuman('dronebabo', makeSbUserId(1), 'z')
    let l = addPlayer(TEAM_MELEE_4, t1, s1, babo)
    expect(hasOpposingSides(l)).toBe(true)

    const [t2, s2] = findAvailableSlot(l)
    expect(t2).toBe(2)
    expect(s2).toBe(0)
    const pachi = createHuman('pachi', makeSbUserId(2), 't')
    l = addPlayer(l, t2, s2, pachi)

    const [t3, s3] = findAvailableSlot(l)
    expect(t3).toBe(3)
    expect(s3).toBe(0)
    const computer1 = createComputer('p')
    l = addPlayer(l, t3, s3, computer1)

    const [t4, s4] = findAvailableSlot(l)
    expect(t4).toBe(0)
    expect(s4).toBe(1)
    const trozz = createHuman('trozz', makeSbUserId(3), 'p')
    l = addPlayer(l, t4, s4, trozz)

    const [t5, s5] = findAvailableSlot(l)
    expect(t5).toBe(1)
    expect(s5).toBe(1)
    const intothetest = createHuman('IntoTheTest', makeSbUserId(4), 'p')
    l = addPlayer(l, t5, s5, intothetest)

    const [t6, s6] = findAvailableSlot(l)
    expect(t6).toBe(2)
    expect(s6).toBe(1)
    const harem = createHuman('harem', makeSbUserId(5), 'p')
    l = addPlayer(l, t6, s6, harem)

    const [t7, s7] = findAvailableSlot(l)
    expect(t7).toBe(-1)
    expect(s7).toBe(-1)
  })

  test('should remove the controlled open slots when the last player on a team leaves', () => {
    const babo = createHuman('dronebabo', makeSbUserId(1), 'z')
    let l = addPlayer(TEAM_MELEE_4, 1, 0, babo)
    evaluateControlledSlot(l.teams.get(1)!.slots.get(1)!, 'controlledOpen', babo.race, babo.id)
    l = removePlayer(l, 1, 0, babo)!

    expect(humanSlotCount(l)).toBe(1)
    expect(hasOpposingSides(l)).toBe(false)
    expect(l.teams.get(1)!.slots.get(0)!.type).toBe('open')
    expect(l.teams.get(1)!.slots.get(1)!.type).toBe('open')

    expect(removePlayer(l, 0, 0, l.host)).toBeUndefined()
  })

  test('should remove all the computers in a team whenever one of the computers is removed', () => {
    const comp1 = createComputer('z')
    let l = addPlayer(TEAM_MELEE_4, 1, 0, comp1)
    const comp2 = l.teams.get(1)!.slots.get(1)!
    expect(comp2.type).toBe('computer')
    expect(comp2.race).toBe(comp1.race)
    l = removePlayer(l, 1, 0, comp1)!

    expect(humanSlotCount(l)).toBe(1)
    expect(hasOpposingSides(l)).toBe(false)
    expect(l.teams.get(1)!.slots.get(0)!.type).toBe('open')
    expect(l.teams.get(1)!.slots.get(1)!.type).toBe('open')

    expect(l.host.name).toBe('Slayers`Boxer')
  })

  test('should reassign slot control if the controller leaves', () => {
    const babo = createHuman('dronebabo', makeSbUserId(1), 'z')
    let l = addPlayer(TEAM_MELEE_2, 0, 1, babo)
    l = removePlayer(l, 0, 0, l.host)!

    expect(humanSlotCount(l)).toBe(1)
    expect(hasOpposingSides(l)).toBe(false)
    expect(l.host).toEqual(babo)
    expect(l.teams.get(0)!.slots.get(1)).toEqual(babo)
    const controlledOpen = l.teams.get(0)!.slots.get(0)!
    evaluateControlledSlot(controlledOpen, 'controlledOpen', 'r', babo.id)
    // Ensure the player in the leaving player's slot got a new ID
    expect(controlledOpen.id).not.toEqual(TEAM_MELEE_2.host.id)
    evaluateControlledSlot(l.teams.get(0)!.slots.get(2)!, 'controlledOpen', 'r', babo.id)
    evaluateControlledSlot(l.teams.get(0)!.slots.get(3)!, 'controlledOpen', 'r', babo.id)
  })

  test('should support moving players between slots in the same team', () => {
    const babo = createHuman('dronebabo', makeSbUserId(1), 'z')
    let l = addPlayer(TEAM_MELEE_2, 0, 1, babo)
    l = movePlayerToSlot(l, 0, 1, 0, 2)

    expect(humanSlotCount(l)).toBe(2)
    expect(hasOpposingSides(l)).toBe(false)

    evaluateControlledSlot(l.teams.get(0)!.slots.get(1)!, 'controlledOpen', 'r', l.host.id)
    evaluateControlledSlot(l.teams.get(0)!.slots.get(3)!, 'controlledOpen', l.host.race, l.host.id)
  })

  test('should support closing an open slot', () => {
    let lobby = TEAM_MELEE_2
    expect(lobby.teams.get(0)!.slots.get(0)).toEqual(lobby.host)
    const openSlot = lobby.teams.get(0)!.slots.get(1)!
    expect(openSlot.type).toBe('controlledOpen')
    expect(lobby.teams.get(0)!.slots.get(2)!.type).toBe('controlledOpen')
    expect(lobby.teams.get(0)!.slots.get(3)!.type).toBe('controlledOpen')
    expect(lobby.teams.get(1)!.slots.get(0)!.type).toBe('open')
    expect(lobby.teams.get(1)!.slots.get(1)!.type).toBe('open')
    expect(lobby.teams.get(1)!.slots.get(2)!.type).toBe('open')
    expect(lobby.teams.get(1)!.slots.get(3)!.type).toBe('open')

    lobby = closeSlot(lobby, 0, 1)
    expect(lobby.teams.get(0)!.slots.get(0)).toEqual(lobby.host)
    const closedSlot = lobby.teams.get(0)!.slots.get(1)!
    expect(closedSlot.type).toBe('controlledClosed')
    expect(closedSlot.race).toBe(openSlot.race)
    expect(closedSlot.controlledBy).toBe(openSlot.controlledBy)
    expect(lobby.teams.get(0)!.slots.get(2)!.type).toBe('controlledOpen')
    expect(lobby.teams.get(0)!.slots.get(3)!.type).toBe('controlledOpen')
    expect(lobby.teams.get(1)!.slots.get(0)!.type).toBe('open')
    expect(lobby.teams.get(1)!.slots.get(1)!.type).toBe('open')
    expect(lobby.teams.get(1)!.slots.get(2)!.type).toBe('open')
    expect(lobby.teams.get(1)!.slots.get(3)!.type).toBe('open')

    expect(() => closeSlot(lobby, 0, 0)).toThrow()
    expect(() => closeSlot(lobby, 0, 1)).toThrow()
  })

  test('should support opening a closed slot', () => {
    let lobby = TEAM_MELEE_2
    expect(lobby.teams.get(0)!.slots.get(0)).toEqual(lobby.host)
    const openSlot1 = lobby.teams.get(0)!.slots.get(1)!
    expect(openSlot1.type).toBe('controlledOpen')
    expect(openSlot1.race).toBe(lobby.host.race)
    expect(openSlot1.controlledBy).toBe(lobby.host.id)
    expect(lobby.teams.get(0)!.slots.get(2)!.type).toBe('controlledOpen')
    expect(lobby.teams.get(0)!.slots.get(3)!.type).toBe('controlledOpen')
    expect(lobby.teams.get(1)!.slots.get(0)!.type).toBe('open')
    expect(lobby.teams.get(1)!.slots.get(1)!.type).toBe('open')
    expect(lobby.teams.get(1)!.slots.get(2)!.type).toBe('open')
    expect(lobby.teams.get(1)!.slots.get(3)!.type).toBe('open')

    lobby = closeSlot(lobby, 0, 1)
    expect(lobby.teams.get(0)!.slots.get(0)).toEqual(lobby.host)
    const closedSlot = lobby.teams.get(0)!.slots.get(1)!
    expect(closedSlot.type).toBe('controlledClosed')
    expect(closedSlot.race).toBe(openSlot1.race)
    expect(closedSlot.controlledBy).toBe(openSlot1.controlledBy)
    expect(lobby.teams.get(0)!.slots.get(2)!.type).toBe('controlledOpen')
    expect(lobby.teams.get(0)!.slots.get(3)!.type).toBe('controlledOpen')
    expect(lobby.teams.get(1)!.slots.get(0)!.type).toBe('open')
    expect(lobby.teams.get(1)!.slots.get(1)!.type).toBe('open')
    expect(lobby.teams.get(1)!.slots.get(2)!.type).toBe('open')
    expect(lobby.teams.get(1)!.slots.get(3)!.type).toBe('open')

    lobby = openSlot(lobby, 0, 1)
    expect(lobby.teams.get(0)!.slots.get(0)).toEqual(lobby.host)
    const openSlot2 = lobby.teams.get(0)!.slots.get(1)!
    expect(openSlot2.type).toBe('controlledOpen')
    expect(openSlot2.race).toBe(closedSlot.race)
    expect(openSlot2.controlledBy).toBe(closedSlot.controlledBy)
    expect(lobby.teams.get(0)!.slots.get(2)!.type).toBe('controlledOpen')
    expect(lobby.teams.get(0)!.slots.get(3)!.type).toBe('controlledOpen')
    expect(lobby.teams.get(1)!.slots.get(0)!.type).toBe('open')
    expect(lobby.teams.get(1)!.slots.get(1)!.type).toBe('open')
    expect(lobby.teams.get(1)!.slots.get(2)!.type).toBe('open')
    expect(lobby.teams.get(1)!.slots.get(3)!.type).toBe('open')

    expect(() => openSlot(lobby, 0, 0)).toThrow()
    expect(() => openSlot(lobby, 0, 1)).toThrow()
  })

  test('should only allow a single race for computer teams', () => {
    const comp = createComputer('t')
    let lobby = addPlayer(TEAM_MELEE_3, 1, 0, comp)
    expect(lobby.teams.get(1)!.slots.get(0)).toEqual(comp)
    expect(lobby.teams.get(1)!.slots.get(1)!.race).toBe('t')
    expect(lobby.teams.get(1)!.slots.get(2)!.race).toBe('t')

    lobby = setRace(lobby, 1, 1, 'r')
    expect(lobby.teams.get(1)!.slots.get(0)!.race).toBe('r')
    expect(lobby.teams.get(1)!.slots.get(1)!.race).toBe('r')
    expect(lobby.teams.get(1)!.slots.get(2)!.race).toBe('r')
  })
})

const UMS_MAP_1: MapInfo = {
  id: 'sunken-defense',
  hash: 'defe175e',
  name: 'Sunken Defense',
  description: '',
  uploadedBy: { id: 1, name: 'someperson' },
  uploadDate: new Date(0),
  visibility: MapVisibility.Official,
  mapData: {
    format: 'scx',
    tileset: Tileset.Installation,
    originalName: 'Sunken Defense',
    originalDescription: '',
    slots: 8,
    umsSlots: 8,
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
    width: 256,
    height: 256,
    isEud: false,
    parserVersion: 1,
  },
  imageVersion: 1,
  isFavorited: false,
}
const UMS_MAP_2: MapInfo = {
  id: 'tappavat',
  hash: '12345',
  name: 'tappavat',
  description: '',
  uploadedBy: { id: 1, name: 'someperson' },
  uploadDate: new Date(0),
  visibility: MapVisibility.Official,
  mapData: {
    format: 'scm',
    tileset: Tileset.Installation,
    originalName: 'tappavat',
    originalDescription: '',
    slots: 8,
    umsSlots: 8,
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
    width: 128,
    height: 128,
    isEud: false,
    parserVersion: 1,
  },
  imageVersion: 1,
  isFavorited: false,
}
const UMS_MAP_3: MapInfo = {
  id: 'accipiter',
  hash: '987654321',
  name: 'Accipiter',
  description: '',
  uploadedBy: { id: 1, name: 'someperson' },
  uploadDate: new Date(0),
  visibility: MapVisibility.Official,
  mapData: {
    format: 'scm',
    tileset: Tileset.Installation,
    originalName: 'Accipiter',
    originalDescription: '',
    slots: 2,
    umsSlots: 4,
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
    width: 128,
    height: 128,
    isEud: false,
    parserVersion: 1,
  },
  imageVersion: 1,
  isFavorited: false,
}
const UMS_MAP_4: MapInfo = {
  id: 'team-micro',
  hash: '13579',
  name: 'Team Micro',
  description: '',
  uploadedBy: { id: 1, name: 'someperson' },
  uploadDate: new Date(0),
  visibility: MapVisibility.Official,
  mapData: {
    format: 'scm',
    tileset: Tileset.Installation,
    originalName: 'Team Micro',
    originalDescription: '',
    slots: 8,
    umsSlots: 8,
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
    width: 256,
    height: 256,
    isEud: false,
    parserVersion: 1,
  },
  imageVersion: 1,
  isFavorited: false,
}
const UMS_LOBBY_1 = createLobby(
  'Sunken Defence',
  UMS_MAP_1,
  GameType.UseMapSettings,
  0,
  8,
  'Slayers`Boxer',
  makeSbUserId(27),
  'r',
  false,
)
const UMS_LOBBY_2 = createLobby(
  'tappavat',
  UMS_MAP_2,
  GameType.UseMapSettings,
  0,
  8,
  'Slayers`Boxer',
  makeSbUserId(27),
  'r',
  false,
)
const UMS_LOBBY_3 = createLobby(
  'Accipiter',
  UMS_MAP_3,
  GameType.UseMapSettings,
  0,
  4,
  'Slayers`Boxer',
  makeSbUserId(27),
  'r',
  false,
)
const UMS_LOBBY_4 = createLobby(
  'Team Micro',
  UMS_MAP_4,
  GameType.UseMapSettings,
  0,
  8,
  'Slayers`Boxer',
  makeSbUserId(27),
  'r',
  false,
)

const evaluateUmsLobby = (
  lobby: Lobby,
  teamCount: number,
  humanSlotsCount: number,
  opposingSides: boolean,
  host: Slot,
) => {
  expect(lobby.teams).toHaveProperty('size', teamCount)
  expect(humanSlotCount(lobby)).toBe(humanSlotsCount)
  expect(hasOpposingSides(lobby)).toBe(opposingSides)
  expect(host).toEqual(lobby.host)
}

const evaluateUmsTeam = (
  team: Team,
  teamId: number,
  slotsCount: number,
  hiddenSlotsCount: number,
) => {
  expect(team.teamId).toBe(teamId)
  expect(team.slots).toHaveProperty('size', slotsCount)
  expect(team.hiddenSlots).toHaveProperty('size', hiddenSlotsCount)
}

const evaluateUmsSlot = (
  slot: Slot,
  type: string,
  name: string,
  race: RaceChar,
  hasForcedRace: boolean,
  playerId: number,
) => {
  expect(slot.type).toBe(type)
  expect(slot.name).toBe(name)
  expect(slot.race).toBe(race)
  expect(slot.hasForcedRace).toBe(hasForcedRace)
  expect(slot.playerId).toBe(playerId)
}

describe('Lobbies - Use map settings', () => {
  test('should create the lobby correctly', () => {
    const l1 = UMS_LOBBY_1
    let team1 = l1.teams.get(0)!
    let team2 = l1.teams.get(1)!
    let team3 = l1.teams.get(2)!
    evaluateUmsLobby(l1, 3, 1, true, team1.slots.get(0)!)
    evaluateUmsTeam(team1, 1, 6, 0)
    evaluateUmsTeam(team2, 2, 1, 0)
    evaluateUmsTeam(team3, 3, 1, 0)
    evaluateUmsSlot(team1.slots.get(0)!, 'human', 'Slayers`Boxer', 'z', true, 0)
    evaluateUmsSlot(team1.slots.get(1)!, 'open', 'Open', 'z', true, 1)
    evaluateUmsSlot(team1.slots.get(2)!, 'open', 'Open', 'z', true, 2)
    evaluateUmsSlot(team1.slots.get(3)!, 'open', 'Open', 'z', true, 3)
    evaluateUmsSlot(team1.slots.get(4)!, 'open', 'Open', 'z', true, 4)
    evaluateUmsSlot(team1.slots.get(5)!, 'open', 'Open', 'z', true, 5)
    evaluateUmsSlot(team2.slots.get(0)!, 'umsComputer', 'Computer', 'z', true, 7)
    evaluateUmsSlot(team3.slots.get(0)!, 'umsComputer', 'Computer', 'z', true, 6)

    const l2 = UMS_LOBBY_2
    team1 = l2.teams.get(0)!
    team2 = l2.teams.get(1)!
    team3 = l2.teams.get(2)!
    evaluateUmsLobby(l2, 3, 1, true, team1.slots.get(0)!)
    evaluateUmsTeam(team1, 1, 1, 0)
    evaluateUmsTeam(team2, 2, 6, 0)
    evaluateUmsTeam(team3, 4, 1, 0)
    evaluateUmsSlot(team1.slots.get(0)!, 'human', 'Slayers`Boxer', 't', true, 1)
    evaluateUmsSlot(team2.slots.get(0)!, 'umsComputer', 'Computer', 't', true, 0)
    evaluateUmsSlot(team2.slots.get(1)!, 'umsComputer', 'Computer', 'z', true, 3)
    evaluateUmsSlot(team2.slots.get(2)!, 'umsComputer', 'Computer', 'z', true, 4)
    evaluateUmsSlot(team2.slots.get(3)!, 'umsComputer', 'Computer', 'z', true, 5)
    evaluateUmsSlot(team2.slots.get(4)!, 'umsComputer', 'Computer', 't', true, 6)
    evaluateUmsSlot(team2.slots.get(5)!, 'umsComputer', 'Computer', 'z', true, 7)
    evaluateUmsSlot(team3.slots.get(0)!, 'umsComputer', 'Computer', 'p', true, 2)

    const l3 = UMS_LOBBY_3
    team1 = l3.teams.get(0)!
    team2 = l3.teams.get(1)!
    evaluateUmsLobby(l3, 2, 1, false, team1.slots.get(0)!)
    evaluateUmsTeam(team1, 1, 2, 0)
    evaluateUmsTeam(team2, 2, 2, 0)
    evaluateUmsSlot(team1.slots.get(0)!, 'human', 'Slayers`Boxer', 'r', false, 0)
    evaluateUmsSlot(team1.slots.get(1)!, 'open', 'Open', 'r', false, 1)
    evaluateUmsSlot(team2.slots.get(0)!, 'open', 'Open', 'p', true, 2)
    evaluateUmsSlot(team2.slots.get(1)!, 'open', 'Open', 't', true, 3)

    const l4 = UMS_LOBBY_4
    team1 = l4.teams.get(0)!
    team2 = l4.teams.get(1)!
    team3 = l4.teams.get(2)!
    const team4 = l4.teams.get(3)!
    evaluateUmsLobby(l4, 4, 1, false, team1.slots.get(0)!)
    evaluateUmsTeam(team1, 1, 3, 0)
    evaluateUmsTeam(team2, 2, 3, 0)
    evaluateUmsTeam(team3, 3, 0, 1)
    evaluateUmsTeam(team4, 4, 0, 1)
    evaluateUmsSlot(team1.slots.get(0)!, 'human', 'Slayers`Boxer', 't', true, 0)
    evaluateUmsSlot(team1.slots.get(1)!, 'open', 'Open', 't', true, 1)
    evaluateUmsSlot(team1.slots.get(2)!, 'open', 'Open', 't', true, 2)
    evaluateUmsSlot(team2.slots.get(0)!, 'open', 'Open', 't', true, 3)
    evaluateUmsSlot(team2.slots.get(1)!, 'open', 'Open', 't', true, 4)
    evaluateUmsSlot(team2.slots.get(2)!, 'open', 'Open', 't', true, 5)
    evaluateUmsSlot(team3.hiddenSlots.get(0)!, 'umsComputer', 'Computer', 't', true, 6)
    evaluateUmsSlot(team4.hiddenSlots.get(0)!, 'umsComputer', 'Computer', 't', true, 7)
  })

  test('should support removing players', () => {
    const babo = createHuman('dronebabo', makeSbUserId(1), 'z', true, 1)
    let lobby = addPlayer(UMS_LOBBY_1, 0, 1, babo)

    let team1 = lobby.teams.get(0)!
    evaluateUmsLobby(lobby, 3, 2, true, team1.slots.get(0)!)
    evaluateUmsSlot(team1.slots.get(1)!, 'human', 'dronebabo', 'z', true, 1)

    lobby = removePlayer(lobby, 0, 1, team1.slots.get(1)!)!
    team1 = lobby.teams.get(0)!
    evaluateUmsLobby(lobby, 3, 1, true, team1.slots.get(0)!)
    evaluateUmsSlot(team1.slots.get(1)!, 'open', 'Open', 'z', true, 1)
  })

  test('should support moving players between slots', () => {
    let l1 = UMS_LOBBY_1
    let team1 = l1.teams.get(0)!
    let team2 = l1.teams.get(1)!
    let team3 = l1.teams.get(2)!
    evaluateUmsLobby(l1, 3, 1, true, team1.slots.get(0)!)
    evaluateUmsTeam(team1, 1, 6, 0)
    evaluateUmsTeam(team2, 2, 1, 0)
    evaluateUmsTeam(team3, 3, 1, 0)
    evaluateUmsSlot(team1.slots.get(0)!, 'human', 'Slayers`Boxer', 'z', true, 0)
    evaluateUmsSlot(team1.slots.get(1)!, 'open', 'Open', 'z', true, 1)
    evaluateUmsSlot(team1.slots.get(2)!, 'open', 'Open', 'z', true, 2)
    evaluateUmsSlot(team1.slots.get(3)!, 'open', 'Open', 'z', true, 3)
    evaluateUmsSlot(team1.slots.get(4)!, 'open', 'Open', 'z', true, 4)
    evaluateUmsSlot(team1.slots.get(5)!, 'open', 'Open', 'z', true, 5)
    evaluateUmsSlot(team2.slots.get(0)!, 'umsComputer', 'Computer', 'z', true, 7)
    evaluateUmsSlot(team3.slots.get(0)!, 'umsComputer', 'Computer', 'z', true, 6)

    l1 = movePlayerToSlot(l1, 0, 0, 0, 1)
    team1 = l1.teams.get(0)!
    team2 = l1.teams.get(1)!
    team3 = l1.teams.get(2)!
    evaluateUmsLobby(l1, 3, 1, true, team1.slots.get(1)!)
    evaluateUmsTeam(team1, 1, 6, 0)
    evaluateUmsTeam(team2, 2, 1, 0)
    evaluateUmsTeam(team3, 3, 1, 0)
    evaluateUmsSlot(team1.slots.get(0)!, 'open', 'Open', 'z', true, 0)
    evaluateUmsSlot(team1.slots.get(1)!, 'human', 'Slayers`Boxer', 'z', true, 1)
    evaluateUmsSlot(team1.slots.get(2)!, 'open', 'Open', 'z', true, 2)
    evaluateUmsSlot(team1.slots.get(3)!, 'open', 'Open', 'z', true, 3)
    evaluateUmsSlot(team1.slots.get(4)!, 'open', 'Open', 'z', true, 4)
    evaluateUmsSlot(team1.slots.get(5)!, 'open', 'Open', 'z', true, 5)
    evaluateUmsSlot(team2.slots.get(0)!, 'umsComputer', 'Computer', 'z', true, 7)
    evaluateUmsSlot(team3.slots.get(0)!, 'umsComputer', 'Computer', 'z', true, 6)

    let l3 = UMS_LOBBY_3
    team1 = l3.teams.get(0)!
    team2 = l3.teams.get(1)!
    evaluateUmsLobby(l3, 2, 1, false, team1.slots.get(0)!)
    evaluateUmsTeam(team1, 1, 2, 0)
    evaluateUmsTeam(team2, 2, 2, 0)
    evaluateUmsSlot(team1.slots.get(0)!, 'human', 'Slayers`Boxer', 'r', false, 0)
    evaluateUmsSlot(team1.slots.get(1)!, 'open', 'Open', 'r', false, 1)
    evaluateUmsSlot(team2.slots.get(0)!, 'open', 'Open', 'p', true, 2)
    evaluateUmsSlot(team2.slots.get(1)!, 'open', 'Open', 't', true, 3)

    l3 = movePlayerToSlot(l3, 0, 0, 0, 1)
    team1 = l3.teams.get(0)!
    team2 = l3.teams.get(1)!
    evaluateUmsLobby(l3, 2, 1, false, team1.slots.get(1)!)
    evaluateUmsTeam(team1, 1, 2, 0)
    evaluateUmsTeam(team2, 2, 2, 0)
    evaluateUmsSlot(team1.slots.get(0)!, 'open', 'Open', 'r', false, 0)
    evaluateUmsSlot(team1.slots.get(1)!, 'human', 'Slayers`Boxer', 'r', false, 1)
    evaluateUmsSlot(team2.slots.get(0)!, 'open', 'Open', 'p', true, 2)
    evaluateUmsSlot(team2.slots.get(1)!, 'open', 'Open', 't', true, 3)
  })

  test('should support closing an open slot', () => {
    let l1 = UMS_LOBBY_1
    let team1 = l1.teams.get(0)!
    let team2 = l1.teams.get(1)!
    let team3 = l1.teams.get(2)!
    evaluateUmsLobby(l1, 3, 1, true, team1.slots.get(0)!)
    evaluateUmsTeam(team1, 1, 6, 0)
    evaluateUmsTeam(team2, 2, 1, 0)
    evaluateUmsTeam(team3, 3, 1, 0)
    evaluateUmsSlot(team1.slots.get(0)!, 'human', 'Slayers`Boxer', 'z', true, 0)
    evaluateUmsSlot(team1.slots.get(1)!, 'open', 'Open', 'z', true, 1)
    evaluateUmsSlot(team1.slots.get(2)!, 'open', 'Open', 'z', true, 2)
    evaluateUmsSlot(team1.slots.get(3)!, 'open', 'Open', 'z', true, 3)
    evaluateUmsSlot(team1.slots.get(4)!, 'open', 'Open', 'z', true, 4)
    evaluateUmsSlot(team1.slots.get(5)!, 'open', 'Open', 'z', true, 5)
    evaluateUmsSlot(team2.slots.get(0)!, 'umsComputer', 'Computer', 'z', true, 7)
    evaluateUmsSlot(team3.slots.get(0)!, 'umsComputer', 'Computer', 'z', true, 6)

    l1 = closeSlot(l1, 0, 1)
    team1 = l1.teams.get(0)!
    team2 = l1.teams.get(1)!
    team3 = l1.teams.get(2)!
    evaluateUmsLobby(l1, 3, 1, true, team1.slots.get(0)!)
    evaluateUmsTeam(team1, 1, 6, 0)
    evaluateUmsTeam(team2, 2, 1, 0)
    evaluateUmsTeam(team3, 3, 1, 0)
    evaluateUmsSlot(team1.slots.get(0)!, 'human', 'Slayers`Boxer', 'z', true, 0)
    evaluateUmsSlot(team1.slots.get(1)!, 'closed', 'Closed', 'z', true, 1)
    evaluateUmsSlot(team1.slots.get(2)!, 'open', 'Open', 'z', true, 2)
    evaluateUmsSlot(team1.slots.get(3)!, 'open', 'Open', 'z', true, 3)
    evaluateUmsSlot(team1.slots.get(4)!, 'open', 'Open', 'z', true, 4)
    evaluateUmsSlot(team1.slots.get(5)!, 'open', 'Open', 'z', true, 5)
    evaluateUmsSlot(team2.slots.get(0)!, 'umsComputer', 'Computer', 'z', true, 7)
    evaluateUmsSlot(team3.slots.get(0)!, 'umsComputer', 'Computer', 'z', true, 6)
  })

  test('should support opening a closed slot', () => {
    let l1 = UMS_LOBBY_1
    let team1 = l1.teams.get(0)!
    let team2 = l1.teams.get(1)!
    let team3 = l1.teams.get(2)!
    evaluateUmsLobby(l1, 3, 1, true, team1.slots.get(0)!)
    evaluateUmsTeam(team1, 1, 6, 0)
    evaluateUmsTeam(team2, 2, 1, 0)
    evaluateUmsTeam(team3, 3, 1, 0)
    evaluateUmsSlot(team1.slots.get(0)!, 'human', 'Slayers`Boxer', 'z', true, 0)
    evaluateUmsSlot(team1.slots.get(1)!, 'open', 'Open', 'z', true, 1)
    evaluateUmsSlot(team1.slots.get(2)!, 'open', 'Open', 'z', true, 2)
    evaluateUmsSlot(team1.slots.get(3)!, 'open', 'Open', 'z', true, 3)
    evaluateUmsSlot(team1.slots.get(4)!, 'open', 'Open', 'z', true, 4)
    evaluateUmsSlot(team1.slots.get(5)!, 'open', 'Open', 'z', true, 5)
    evaluateUmsSlot(team2.slots.get(0)!, 'umsComputer', 'Computer', 'z', true, 7)
    evaluateUmsSlot(team3.slots.get(0)!, 'umsComputer', 'Computer', 'z', true, 6)

    l1 = closeSlot(l1, 0, 1)
    team1 = l1.teams.get(0)!
    team2 = l1.teams.get(1)!
    team3 = l1.teams.get(2)!
    evaluateUmsLobby(l1, 3, 1, true, team1.slots.get(0)!)
    evaluateUmsTeam(team1, 1, 6, 0)
    evaluateUmsTeam(team2, 2, 1, 0)
    evaluateUmsTeam(team3, 3, 1, 0)
    evaluateUmsSlot(team1.slots.get(0)!, 'human', 'Slayers`Boxer', 'z', true, 0)
    evaluateUmsSlot(team1.slots.get(1)!, 'closed', 'Closed', 'z', true, 1)
    evaluateUmsSlot(team1.slots.get(2)!, 'open', 'Open', 'z', true, 2)
    evaluateUmsSlot(team1.slots.get(3)!, 'open', 'Open', 'z', true, 3)
    evaluateUmsSlot(team1.slots.get(4)!, 'open', 'Open', 'z', true, 4)
    evaluateUmsSlot(team1.slots.get(5)!, 'open', 'Open', 'z', true, 5)
    evaluateUmsSlot(team2.slots.get(0)!, 'umsComputer', 'Computer', 'z', true, 7)
    evaluateUmsSlot(team3.slots.get(0)!, 'umsComputer', 'Computer', 'z', true, 6)

    l1 = openSlot(l1, 0, 1)
    team1 = l1.teams.get(0)!
    team2 = l1.teams.get(1)!
    team3 = l1.teams.get(2)!
    evaluateUmsLobby(l1, 3, 1, true, team1.slots.get(0)!)
    evaluateUmsTeam(team1, 1, 6, 0)
    evaluateUmsTeam(team2, 2, 1, 0)
    evaluateUmsTeam(team3, 3, 1, 0)
    evaluateUmsSlot(team1.slots.get(0)!, 'human', 'Slayers`Boxer', 'z', true, 0)
    evaluateUmsSlot(team1.slots.get(1)!, 'open', 'Open', 'z', true, 1)
    evaluateUmsSlot(team1.slots.get(2)!, 'open', 'Open', 'z', true, 2)
    evaluateUmsSlot(team1.slots.get(3)!, 'open', 'Open', 'z', true, 3)
    evaluateUmsSlot(team1.slots.get(4)!, 'open', 'Open', 'z', true, 4)
    evaluateUmsSlot(team1.slots.get(5)!, 'open', 'Open', 'z', true, 5)
    evaluateUmsSlot(team2.slots.get(0)!, 'umsComputer', 'Computer', 'z', true, 7)
    evaluateUmsSlot(team3.slots.get(0)!, 'umsComputer', 'Computer', 'z', true, 6)
  })
})
