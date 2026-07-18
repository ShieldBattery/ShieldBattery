import { ReplayHeader, ReplayPlayer, ReplayRace } from 'jssuh'
import { describe, expect, test } from 'vitest'
import { RaceChar } from '../../common/races'
import { NON_EXISTING_USER_ID, ReplayShieldBatteryData } from '../../common/replays'
import { ReplayLibraryPlayer } from '../../common/replays-library'
import { makeSbUserId, SbUserId } from '../../common/users/sb-user-id'
import {
  getReplayTeamRaces,
  headerNeedsUtf8Redecode,
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

function makePlayer(overrides: Partial<ReplayPlayer> & Pick<ReplayPlayer, 'id'>): ReplayPlayer {
  return {
    name: `player${overrides.id}`,
    race: 'terran' as ReplayRace,
    team: 0,
    isComputer: false,
    ...overrides,
  }
}

function makeHeader(overrides: Partial<ReplayHeader> = {}): ReplayHeader {
  return {
    gameName: 'Test Game',
    mapName: 'Fighting Spirit',
    gameType: 2,
    gameSubtype: 0,
    players: [],
    durationFrames: 14_400,
    // Unix seconds; the mapper multiplies by 1000 for the stored game time.
    seed: 1_700_000_000,
    remastered: true,
    ...overrides,
  }
}

/** Builds an 8-length userIds array, defaulting empty slots to `NON_EXISTING_USER_ID`. */
function makeUserIds(entries: Record<number, number>): SbUserId[] {
  const ids: SbUserId[] = []
  for (let i = 0; i < 8; i++) {
    ids.push(makeSbUserId(entries[i] ?? NON_EXISTING_USER_ID))
  }
  return ids
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
    const header = makeHeader({
      players: [
        makePlayer({ id: 0, name: 'Alice', race: 'protoss', team: 0 }),
        makePlayer({ id: 1, name: 'Bob', race: 'zerg', team: 1 }),
      ],
    })
    const sbData: ReplayShieldBatteryData = {
      formatVersion: 1,
      starcraftExeBuild: 1234,
      shieldBatteryVersion: '9.0.0',
      gameId: '12345678-9abc-def0-1234-56789abcdef0',
      userIds: makeUserIds({ 0: 100, 1: 200 }),
    }

    const record = mapReplayHeaderToRecord(FILE_INFO, header, sbData)

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
    const header = makeHeader({
      players: [
        makePlayer({ id: 0, name: 'Carol', race: 'terran', team: 0 }),
        makePlayer({ id: 1, name: 'Dave', race: 'protoss', team: 1 }),
      ],
    })

    const record = mapReplayHeaderToRecord(FILE_INFO, header, undefined)

    expect(record.sbGameId).toBeUndefined()
    expect(record.players.map(p => p.sbUserId)).toEqual([undefined, undefined])
    expect(record.players.map(p => p.race)).toEqual(['t', 'p'])
  })

  test('team game preserves per-player teams', () => {
    const header = makeHeader({
      gameType: 15,
      players: [
        makePlayer({ id: 0, team: 1 }),
        makePlayer({ id: 1, team: 1 }),
        makePlayer({ id: 2, team: 2 }),
        makePlayer({ id: 3, team: 2 }),
      ],
    })

    const record = mapReplayHeaderToRecord(FILE_INFO, header, undefined)

    expect(record.players.map(p => p.team)).toEqual([1, 1, 2, 2])
  })

  test('computer players get no SB user id even with an SB section', () => {
    const header = makeHeader({
      players: [
        makePlayer({ id: 0, name: 'Human', team: 0 }),
        makePlayer({ id: 1, name: 'Computer', team: 1, isComputer: true }),
      ],
    })
    const sbData: ReplayShieldBatteryData = {
      formatVersion: 1,
      starcraftExeBuild: 1234,
      shieldBatteryVersion: '9.0.0',
      gameId: '00000000-0000-0000-0000-000000000000',
      // Computer slot is left as NON_EXISTING_USER_ID.
      userIds: makeUserIds({ 0: 100 }),
    }

    const record = mapReplayHeaderToRecord(FILE_INFO, header, sbData)

    expect(record.players[0]).toMatchObject({ isComputer: false, sbUserId: makeSbUserId(100) })
    expect(record.players[1]).toMatchObject({ isComputer: true, sbUserId: undefined })
  })

  test('strips color codes from the map name', () => {
    const header = makeHeader({ mapName: 'Neo Sylphid' })

    const record = mapReplayHeaderToRecord(FILE_INFO, header, undefined)

    expect(record.mapName).toBe('Neo Sylphid')
  })

  test('plain 1v1 (single team split into two teams) derives team size and matchup', () => {
    const header = makeHeader({
      players: [
        makePlayer({ id: 0, race: 'protoss', team: 0 }),
        makePlayer({ id: 1, race: 'zerg', team: 0 }),
      ],
    })

    const record = mapReplayHeaderToRecord(FILE_INFO, header, undefined)

    expect(record.teamSize).toBe(1)
    expect(record.matchup).toBe('p-z')
  })

  test('2v2 derives team size and matchup', () => {
    const header = makeHeader({
      gameType: 15,
      players: [
        makePlayer({ id: 0, race: 'protoss', team: 1 }),
        makePlayer({ id: 1, race: 'terran', team: 1 }),
        makePlayer({ id: 2, race: 'zerg', team: 2 }),
        makePlayer({ id: 3, race: 'zerg', team: 2 }),
      ],
    })

    const record = mapReplayHeaderToRecord(FILE_INFO, header, undefined)

    expect(record.teamSize).toBe(2)
    expect(record.matchup).toBe('pt-zz')
  })

  test('undeterminable layout (three players on one team) yields null team size and matchup', () => {
    const header = makeHeader({
      players: [
        makePlayer({ id: 0, race: 'protoss', team: 0 }),
        makePlayer({ id: 1, race: 'terran', team: 0 }),
        makePlayer({ id: 2, race: 'zerg', team: 0 }),
      ],
    })

    const record = mapReplayHeaderToRecord(FILE_INFO, header, undefined)

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

describe('header string sanitization', () => {
  test('strips NUL terminators and trailing field garbage from names', () => {
    // jssuh's forced-encoding path decodes the whole fixed-width field, so a utf8 re-parse can
    // yield strings like 'name\0<leftover bytes>'
    const header = makeHeader({
      mapName: '투혼 1.4\0abc',
      players: [{ name: 'SgT.FaT\0xy', id: 0, race: 'zerg', team: 1, isComputer: false }],
    })
    const record = mapReplayHeaderToRecord(FILE_INFO, header, undefined)
    expect(record.mapName).toBe('투혼 1.4')
    expect(record.players[0].name).toBe('SgT.FaT')
  })
})

describe('headerNeedsUtf8Redecode', () => {
  test('remastered replay with mangled non-ASCII strings needs the utf8 pass', () => {
    // 투혼 1.4 as UTF-8 bytes mis-decoded by jssuh's cp1252 fallback
    const header = makeHeader({ remastered: true, mapName: 'íˆ¬í˜¼ 1.4' })
    expect(headerNeedsUtf8Redecode(header)).toBe(true)
  })

  test('remastered replay with non-ASCII player names needs the utf8 pass', () => {
    const header = makeHeader({
      remastered: true,
      mapName: 'Fighting Spirit',
      players: [{ name: 'ë°©í˜¸', id: 0, race: 'zerg', team: 1, isComputer: false }],
    })
    expect(headerNeedsUtf8Redecode(header)).toBe(true)
  })

  test('remastered replay with all-ASCII strings does not', () => {
    const header = makeHeader({ remastered: true, mapName: 'Polypoid', gameName: 'ladder game' })
    expect(headerNeedsUtf8Redecode(header)).toBe(false)
  })

  test('1.16 replay never re-decodes (cp949 auto handling is correct for its era)', () => {
    const header = makeHeader({ remastered: false, mapName: '투혼 1.4' })
    expect(headerNeedsUtf8Redecode(header)).toBe(false)
  })
})
