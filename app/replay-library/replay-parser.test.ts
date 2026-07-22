import type { Player, ReplayHeader, ShieldBatteryData } from '@shieldbattery/broodrep'
import { describe, expect, test } from 'vitest'
import { RaceChar } from '../../common/races'
import { NON_EXISTING_USER_ID } from '../../common/replays'
import { ReplayLibraryPlayer } from '../../common/replays-library'
import { makeSbUserId } from '../../common/users/sb-user-id'
import {
  getReplayTeamRaces,
  makeParseErrorRecord,
  mapReplayHeaderToRecord,
  ReplayFileInfo,
} from './replay-parser'

const FILE_INFO: ReplayFileInfo = {
  path: 'C:\\replays\\game.rep',
  fileMtime: 1_700_000_000_000,
  fileSize: 123_456,
  contentHash: 'abc123',
}

function makePlayer(overrides: Partial<Player> & Pick<Player, 'slotId'>): Player {
  return {
    name: `player${overrides.slotId}`,
    networkId: 0,
    playerType: 'human',
    race: 't',
    team: 0,
    isEmpty: false,
    isObserver: false,
    ...overrides,
  }
}

function makeHeader(overrides: Partial<ReplayHeader> = {}): ReplayHeader {
  return {
    engine: 'broodWar',
    frames: 14_400,
    // Unix seconds; the mapper multiplies by 1000 for the stored game time.
    startTime: 1_700_000_000,
    title: 'Test Game',
    mapWidth: 128,
    mapHeight: 128,
    availableSlots: 8,
    speed: 'fastest',
    gameType: 'melee',
    gameSubType: 0,
    hostName: 'Host',
    mapName: 'Fighting Spirit',
    ...overrides,
  }
}

/** Builds an 8-length userIds tuple, defaulting empty slots to `NON_EXISTING_USER_ID`. */
function makeUserIds(entries: Record<number, number>): ShieldBatteryData['userIds'] {
  const ids: number[] = []
  for (let i = 0; i < 8; i++) {
    ids.push(entries[i] ?? NON_EXISTING_USER_ID)
  }
  return ids as ShieldBatteryData['userIds']
}

function makeSbData(overrides: Partial<ShieldBatteryData> = {}): ShieldBatteryData {
  return {
    starcraftExeBuild: 1234,
    shieldbatteryVersion: '9.0.0',
    teamGameMainPlayers: [255, 255, 255, 255],
    startingRaces: ['r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r'],
    gameId: '12345678-9abc-def0-1234-56789abcdef0',
    userIds: makeUserIds({}),
    gameLogicVersion: 0,
    ...overrides,
  }
}

function player(
  team: number,
  race: RaceChar,
  overrides: Partial<ReplayLibraryPlayer> = {},
): ReplayLibraryPlayer {
  return { slot: 0, team, race, name: 'p', isComputer: false, ...overrides }
}

describe('app/replay-library/replay-parser/mapReplayHeaderToRecord', () => {
  test('ShieldBattery 1v1 replay maps players to SB user ids', () => {
    const header = makeHeader()
    const players = [
      makePlayer({ slotId: 0, name: 'Alice', race: 'p', team: 0 }),
      makePlayer({ slotId: 1, name: 'Bob', race: 'z', team: 1 }),
    ]
    const sbData = makeSbData({
      gameId: '12345678-9abc-def0-1234-56789abcdef0',
      userIds: makeUserIds({ 0: 100, 1: 200 }),
    })

    const record = mapReplayHeaderToRecord(FILE_INFO, header, players, sbData)

    expect(record.parseError).toBe(false)
    expect(record.sbGameId).toBe('12345678-9abc-def0-1234-56789abcdef0')
    expect(record.gameTime).toBe(1_700_000_000_000)
    expect(record.gameType).toBe(2)
    expect(record.durationFrames).toBe(14_400)
    expect(record.contentHash).toBe('abc123')
    expect(record.players).toEqual([
      {
        slot: 0,
        team: 0,
        name: 'Alice',
        race: 'p',
        isComputer: false,
        sbUserId: makeSbUserId(100),
      },
      { slot: 1, team: 1, name: 'Bob', race: 'z', isComputer: false, sbUserId: makeSbUserId(200) },
    ])
  })

  test('Battle.net replay (no SB section) has no SB ids', () => {
    const header = makeHeader()
    const players = [
      makePlayer({ slotId: 0, name: 'Carol', race: 't', team: 0 }),
      makePlayer({ slotId: 1, name: 'Dave', race: 'p', team: 1 }),
    ]

    const record = mapReplayHeaderToRecord(FILE_INFO, header, players, undefined)

    expect(record.sbGameId).toBeUndefined()
    expect(record.players.map(p => p.sbUserId)).toEqual([undefined, undefined])
    expect(record.players.map(p => p.race)).toEqual(['t', 'p'])
  })

  test('team game preserves per-player teams', () => {
    const header = makeHeader({ gameType: 'topVsBottom' })
    const players = [
      makePlayer({ slotId: 0, team: 1 }),
      makePlayer({ slotId: 1, team: 1 }),
      makePlayer({ slotId: 2, team: 2 }),
      makePlayer({ slotId: 3, team: 2 }),
    ]

    const record = mapReplayHeaderToRecord(FILE_INFO, header, players, undefined)

    expect(record.players.map(p => p.team)).toEqual([1, 1, 2, 2])
  })

  test('computer players get no SB user id even with an SB section', () => {
    const header = makeHeader()
    const players = [
      makePlayer({ slotId: 0, name: 'Human', team: 0 }),
      makePlayer({ slotId: 1, name: 'Computer', team: 1, playerType: 'computer' }),
    ]
    const sbData = makeSbData({
      gameId: '00000000-0000-0000-0000-000000000000',
      // Computer slot is left as NON_EXISTING_USER_ID.
      userIds: makeUserIds({ 0: 100 }),
    })

    const record = mapReplayHeaderToRecord(FILE_INFO, header, players, sbData)

    expect(record.players[0]).toMatchObject({ isComputer: false, sbUserId: makeSbUserId(100) })
    expect(record.players[1]).toMatchObject({ isComputer: true, sbUserId: undefined })
  })

  test('treats a 0 user id as no SB user (old replays used it for empty slots)', () => {
    const header = makeHeader()
    const players = [
      makePlayer({ slotId: 0, name: 'Human', team: 0 }),
      makePlayer({ slotId: 1, name: 'OldSlot', team: 1 }),
    ]
    const sbData = makeSbData({
      gameId: '00000000-0000-0000-0000-000000000000',
      userIds: makeUserIds({ 0: 100, 1: 0 }),
    })

    const record = mapReplayHeaderToRecord(FILE_INFO, header, players, sbData)

    expect(record.players.map(p => p.sbUserId)).toEqual([makeSbUserId(100), undefined])
  })

  test('strips color codes from the map name', () => {
    const header = makeHeader({ mapName: 'Neo Sylphid' })

    const record = mapReplayHeaderToRecord(FILE_INFO, header, [], undefined)

    expect(record.mapName).toBe('Neo Sylphid')
  })

  test('plain 1v1 (single team split into two teams) derives team size and matchup', () => {
    const header = makeHeader()
    const players = [
      makePlayer({ slotId: 0, race: 'p', team: 0 }),
      makePlayer({ slotId: 1, race: 'z', team: 0 }),
    ]

    const record = mapReplayHeaderToRecord(FILE_INFO, header, players, undefined)

    expect(record.teamSize).toBe(1)
    expect(record.matchup).toBe('p-z')
  })

  test('2v2 derives team size and matchup', () => {
    const header = makeHeader({ gameType: 'topVsBottom' })
    const players = [
      makePlayer({ slotId: 0, race: 'p', team: 1 }),
      makePlayer({ slotId: 1, race: 't', team: 1 }),
      makePlayer({ slotId: 2, race: 'z', team: 2 }),
      makePlayer({ slotId: 3, race: 'z', team: 2 }),
    ]

    const record = mapReplayHeaderToRecord(FILE_INFO, header, players, undefined)

    expect(record.teamSize).toBe(2)
    expect(record.matchup).toBe('pt-zz')
  })

  test('undeterminable layout (three players on one team) yields null team size and matchup', () => {
    const header = makeHeader()
    const players = [
      makePlayer({ slotId: 0, race: 'p', team: 0 }),
      makePlayer({ slotId: 1, race: 't', team: 0 }),
      makePlayer({ slotId: 2, race: 'z', team: 0 }),
    ]

    const record = mapReplayHeaderToRecord(FILE_INFO, header, players, undefined)

    expect(record.teamSize).toBeNull()
    expect(record.matchup).toBeNull()
  })
})

describe('app/replay-library/replay-parser/makeParseErrorRecord', () => {
  test('flags parse errors and keeps file identity', () => {
    const record = makeParseErrorRecord(FILE_INFO)

    expect(record.parseError).toBe(true)
    expect(record.players).toEqual([])
    expect(record.sbGameId).toBeUndefined()
    expect(record.path).toBe(FILE_INFO.path)
    expect(record.fileSize).toBe(FILE_INFO.fileSize)
    expect(record.contentHash).toBe(FILE_INFO.contentHash)
    expect(record.teamSize).toBeNull()
    expect(record.matchup).toBeNull()
  })
})

describe('app/replay-library/replay-parser/getReplayTeamRaces', () => {
  test('two teams are returned as-is', () => {
    expect(getReplayTeamRaces([player(0, 'p'), player(1, 'z')])).toEqual([['p'], ['z']])
  })

  test('single team of two is split into two teams', () => {
    expect(getReplayTeamRaces([player(0, 'p'), player(0, 'z')])).toEqual([['p'], ['z']])
  })

  test('single team of more than two cannot be resolved', () => {
    expect(getReplayTeamRaces([player(0, 'p'), player(0, 'z'), player(0, 't')])).toBeNull()
  })

  test('four players across two teams', () => {
    const teams = getReplayTeamRaces([
      player(1, 'p'),
      player(1, 't'),
      player(2, 'z'),
      player(2, 'z'),
    ])
    expect(teams).toEqual([
      ['p', 't'],
      ['z', 'z'],
    ])
  })
})
