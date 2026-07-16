import { ReplayHeader, ReplayPlayer, ReplayRace } from 'jssuh'
import { describe, expect, test } from 'vitest'
import { NON_EXISTING_USER_ID, ReplayShieldBatteryData } from '../../common/replays'
import { makeSbUserId, SbUserId } from '../../common/users/sb-user-id'
import { makeParseErrorRecord, mapReplayHeaderToRecord, ReplayFileInfo } from './replay-parser'

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
  })
})
