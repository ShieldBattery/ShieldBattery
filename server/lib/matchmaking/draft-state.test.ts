import { ReadonlyDeep } from 'type-fest'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { MapInfo } from '../../../common/maps'
import { AnonymizedNameIndex, MatchmakingEvent } from '../../../common/matchmaking'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { TypedPublisher } from '../websockets/typed-publisher'
import { createSnakePickOrder, DraftState } from './draft-state'
import { MatchmakingPlayer } from './matchmaking-entity'

vi.mock('../messaging/process-chat-message', () => ({
  processMessageContents: vi.fn(async (text: string) => [
    text.replace('@teammate', '<@2>'),
    [],
    [],
  ]),
}))

describe('matchmaking/draft-state/createSnakePickOrder', () => {
  test('2v2 lets the lower-rated team pick first and last', () => {
    expect(createSnakePickOrder(2, 0)).toEqual([
      { team: 0, slot: 0 },
      { team: 1, slot: 0 },
      { team: 1, slot: 1 },
      { team: 0, slot: 1 },
    ])
    expect(createSnakePickOrder(2, 1)).toEqual([
      { team: 1, slot: 0 },
      { team: 0, slot: 0 },
      { team: 0, slot: 1 },
      { team: 1, slot: 1 },
    ])
  })

  test('3v3 lets the higher-rated team pick first and the lower-rated team pick last', () => {
    expect(createSnakePickOrder(3, 0)).toEqual([
      { team: 1, slot: 0 },
      { team: 0, slot: 0 },
      { team: 0, slot: 1 },
      { team: 1, slot: 1 },
      { team: 1, slot: 2 },
      { team: 0, slot: 2 },
    ])
    expect(createSnakePickOrder(3, 1)).toEqual([
      { team: 0, slot: 0 },
      { team: 1, slot: 0 },
      { team: 1, slot: 1 },
      { team: 0, slot: 1 },
      { team: 0, slot: 2 },
      { team: 1, slot: 2 },
    ])
  })
})

describe('matchmaking/draft-state/DraftState', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function makePlayer(id: number, rating: number): MatchmakingPlayer {
    return { id: makeSbUserId(id), race: 'p', rating } as MatchmakingPlayer
  }

  function createDraft(teams: MatchmakingPlayer[][]) {
    const publisher = { publish: vi.fn() } as unknown as TypedPublisher<
      ReadonlyDeep<MatchmakingEvent>
    >
    return new DraftState(
      'match-id',
      teams,
      {} as MapInfo,
      new AbortController(),
      publisher,
      new Map(),
      {
        settings: new Map(),
        players: teams.flat().map((player, i) => ({
          userId: player.id,
          nameIndex: i as AnonymizedNameIndex,
          muteChat: false,
        })),
      },
    )
  }

  /** Locks in every pick as it comes up, returning the user IDs in the order they picked. */
  async function runDraft(draft: DraftState): Promise<number[]> {
    const pickers: number[] = []
    await vi.advanceTimersByTimeAsync(5000)
    for (let picker = draft.getCurrentPicker(); picker; picker = draft.getCurrentPicker()) {
      pickers.push(picker.userId)
      draft.lockInPick(picker.userId, 'z')
      await vi.advanceTimersByTimeAsync(2000)
    }
    await draft.completedPromise
    return pickers
  }

  test('keeps snapshot aliases and mute flags in draft state and blocks muted chat', async () => {
    const ids = [1, 2, 3, 4].map(makeSbUserId)
    const settings = new Map(
      ids.map((id, i) => [id, { anonymizePlayers: i === 0, muteChat: i === 0 }]),
    )
    const players = ids.map((userId, i) => ({
      userId,
      nameIndex: i as 0 | 1 | 2 | 3,
      muteChat: i === 0,
    }))
    const publisher = { publish: vi.fn() } as unknown as TypedPublisher<
      ReadonlyDeep<MatchmakingEvent>
    >
    const draft = new DraftState(
      'match',
      [
        [makePlayer(1, 1600), makePlayer(2, 1500)],
        [makePlayer(3, 1200), makePlayer(4, 1000)],
      ],
      {} as MapInfo,
      new AbortController(),
      publisher,
      new Map(),
      { settings, players },
    )
    const getState = (id: (typeof ids)[number]) => (draft as any).getClientDraftState(id)
    const before = getState(ids[0])
    expect(before.zenMode).toEqual({ anonymizePlayers: true, muteChat: true })
    expect(
      before.ownTeam.players.find((p: { userId: number }) => p.userId === ids[0]),
    ).toMatchObject({ nameIndex: 0, zenMuted: true })
    expect(before.opponentTeam.players.map((p: { nameIndex: number }) => p.nameIndex)).toEqual([
      3, 2,
    ])
    expect(before.opponentTeam.players.every((p: object) => !('userId' in p))).toBe(true)
    await expect(draft.sendChatMessage(ids[0], 'hello')).rejects.toMatchObject({
      code: 'zenChatMuted',
    })
    await vi.advanceTimersByTimeAsync(5000)
    const picker = draft.getCurrentPicker()!
    draft.lockInPick(picker.userId, 'z')
    const after = getState(ids[0])
    expect(after.ownTeam.players.map((p: { nameIndex: number }) => p.nameIndex)).toEqual(
      before.ownTeam.players.map((p: { nameIndex: number }) => p.nameIndex),
    )
    expect(after.opponentTeam.players.map((p: { nameIndex: number }) => p.nameIndex)).toEqual(
      before.opponentTeam.players.map((p: { nameIndex: number }) => p.nameIndex),
    )
    await vi.advanceTimersByTimeAsync(2000)
  })

  test('2v2 gives the lower-rated team the first and final picks', async () => {
    const draft = createDraft([
      [makePlayer(1, 1600), makePlayer(2, 1500)],
      [makePlayer(3, 1200), makePlayer(4, 1000)],
    ])

    // Within a team, the lower-rated player picks first
    expect(await runDraft(draft)).toEqual([4, 2, 1, 3])
  })

  test('3v3 gives the lower-rated team the final pick', async () => {
    const draft = createDraft([
      [makePlayer(1, 1000), makePlayer(2, 1100), makePlayer(3, 1200)],
      [makePlayer(4, 1500), makePlayer(5, 1600), makePlayer(6, 1700)],
    ])

    expect(await runDraft(draft)).toEqual([4, 1, 2, 5, 6, 3])
  })

  test('logs the draft chat in order, as its senders wrote it', async () => {
    const draft = createDraft([
      [makePlayer(1, 1600), makePlayer(2, 1500)],
      [makePlayer(3, 1200), makePlayer(4, 1000)],
    ])
    vi.setSystemTime(new Date('2026-10-31T12:00:00Z'))

    await draft.sendChatMessage(makeSbUserId(1), 'zerg pls @teammate')
    vi.setSystemTime(new Date('2026-10-31T12:00:05Z'))
    await draft.sendChatMessage(makeSbUserId(3), 'gl hf')

    expect(draft.getChatLog()).toEqual([
      {
        userId: makeSbUserId(1),
        sentAt: new Date('2026-10-31T12:00:00Z'),
        text: 'zerg pls @teammate',
      },
      { userId: makeSbUserId(3), sentAt: new Date('2026-10-31T12:00:05Z'), text: 'gl hf' },
    ])
  })
})
