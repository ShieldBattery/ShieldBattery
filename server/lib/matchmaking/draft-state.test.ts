import { ReadonlyDeep } from 'type-fest'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { MapInfo } from '../../../common/maps'
import { MatchmakingEvent } from '../../../common/matchmaking'
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
