import { beforeEach, describe, expect, test, vi } from 'vitest'

const { client, transact, checkUnclearedMatchmakingBan, addMatchmakingBan } = vi.hoisted(() => {
  const client = { query: vi.fn() }
  return {
    client,
    transact: vi.fn(
      async (next: (connection: typeof client) => Promise<unknown>) => await next(client),
    ),
    checkUnclearedMatchmakingBan: vi.fn(),
    addMatchmakingBan: vi.fn(),
  }
})

vi.mock('tsyringe', () => ({
  container: { resolve: vi.fn() },
  singleton: () => (target: unknown) => target,
  injectable: () => (target: unknown) => target,
  inject: () => () => {},
  delay: (next: unknown) => next,
}))
vi.mock('../db/transaction', () => ({ default: transact }))
vi.mock('./matchmaking-ban-models', () => ({
  addMatchmakingBan,
  checkActiveMatchmakingBan: vi.fn(),
  checkUnclearedMatchmakingBan,
  GAME_PENALTY_ENFORCEMENT_LEASE_MINUTES: 5,
  markClearedBans: vi.fn(),
}))

import { MatchmakingBanService } from './matchmaking-ban-service'

const USER_ID = 7 as any
const GAME_ID = '11111111-2222-4333-8444-555555555555'
const IDS = [[1, 'identifier']] as const

beforeEach(() => {
  vi.clearAllMocks()
  transact.mockImplementation(async next => await next(client))
  checkUnclearedMatchmakingBan.mockResolvedValue(undefined)
  addMatchmakingBan.mockResolvedValue(undefined)
  client.query.mockImplementation(async query => {
    const text = typeof query === 'string' ? query : query.text
    if (text?.includes('SELECT penalty')) return { rowCount: 0, rows: [] }
    if (text?.includes('UPDATE matchmaking_game_bans')) return { rowCount: 1, rows: [] }
    return { rowCount: 1, rows: [] }
  })
})

describe('matchmaking/matchmaking-ban-service game penalties', () => {
  test('records an outcome and claims enforcement with the same transaction as escalation', async () => {
    const service = new MatchmakingBanService({ now: () => 1_000 } as any)

    await expect(service.applyGamePenalty(USER_ID, IDS, GAME_ID)).resolves.toEqual({
      penalty: 'lossAndWarning',
      needsEnforcement: true,
    })
    expect(transact).toHaveBeenCalledTimes(1)
    expect(checkUnclearedMatchmakingBan).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID }),
      client,
    )
    expect(addMatchmakingBan).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID, banDurationMillis: 0 }),
      client,
    )
  })

  test('does not escalate again for an existing game outcome', async () => {
    client.query.mockImplementation(async query => {
      const text = typeof query === 'string' ? query : query.text
      if (text?.includes('SELECT penalty')) {
        return { rowCount: 1, rows: [{ penalty: 'lossAndBan' }] }
      }
      if (text?.includes('UPDATE matchmaking_game_bans')) return { rowCount: 0, rows: [] }
      return { rowCount: 1, rows: [] }
    })
    const service = new MatchmakingBanService({ now: () => 1_000 } as any)

    await expect(service.applyGamePenalty(USER_ID, IDS, GAME_ID)).resolves.toEqual({
      penalty: 'lossAndBan',
      needsEnforcement: false,
    })
    expect(checkUnclearedMatchmakingBan).not.toHaveBeenCalled()
    expect(addMatchmakingBan).not.toHaveBeenCalled()
  })

  test('rolls back a new game outcome when the account consequence fails', async () => {
    addMatchmakingBan.mockRejectedValueOnce(new Error('insert failed'))
    const service = new MatchmakingBanService({ now: () => 1_000 } as any)

    await expect(service.applyGamePenalty(USER_ID, IDS, GAME_ID)).rejects.toThrow('insert failed')
    expect(client.query).not.toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('INSERT INTO matchmaking_game_bans'),
      }),
    )
  })

  test('keeps legacy calls outside the game claim transaction', async () => {
    const service = new MatchmakingBanService({ now: () => 1_000 } as any)

    await service.banUser(USER_ID, IDS)

    expect(transact).not.toHaveBeenCalled()
    expect(addMatchmakingBan).toHaveBeenCalledWith(expect.anything(), undefined)
  })

  test('acknowledges live-match enforcement without another account penalty', async () => {
    const service = new MatchmakingBanService({ now: () => 1_000 } as any)

    await service.acknowledgeGamePenaltyEnforced(GAME_ID, USER_ID)

    expect(checkUnclearedMatchmakingBan).not.toHaveBeenCalled()
    expect(addMatchmakingBan).not.toHaveBeenCalled()
    expect(client.query).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('SET enforced_at = NOW()') }),
    )
  })
})
