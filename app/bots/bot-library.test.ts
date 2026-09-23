import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { InstalledBotRelease } from '../../common/bots/bot-library'
import { PracticeLaunchRequest } from '../../common/bots/practice'
import { GameType } from '../../common/games/game-type'
import type { LocalGameManager } from '../game/local-game-manager'
import { BotLibrary } from './bot-library'

// Only the library's edges are faked: Electron, the store on disk, Java detection, and the
// learning-profile file I/O (so a reset can be held mid-flight). Leasing and the per-bot change
// queue run for real.
vi.mock('electron', () => ({
  BrowserWindow: class {},
  dialog: {},
  net: { fetch: () => Promise.reject(new Error('offline')) },
  shell: {},
}))
vi.mock('../logger', () => ({
  default: { verbose: () => {}, warning: () => {}, error: () => {} },
}))

const INSTALLED = {
  botId: 'zzzkbot',
  releaseId: 'zzzkbot-1',
  bot: { id: 'zzzkbot', name: 'ZZZKBot', authors: [] },
  package: {
    profile: { selectableRaces: ['zerg'] },
    launch: { entrypoint: 'ZZZKBot.exe', arguments: [], workingDirectory: '.' },
    writableDirectories: [],
    runtime: { kind: 'native' },
    licenses: [],
  },
} as unknown as InstalledBotRelease

const learning = vi.hoisted(() => ({
  resetLearning: vi.fn(async (): Promise<void> => {}),
  ensureWorkingCopy: vi.fn(async () => 'profiles/zzzkbot/0'),
  hasLearningData: vi.fn(async () => false),
}))
vi.mock('./learning-profiles', async importOriginal => ({
  ...(await importOriginal<typeof import('./learning-profiles')>()),
  ...learning,
}))
vi.mock('./library-store', async importOriginal => {
  const actual = await importOriginal<typeof import('./library-store')>()
  return {
    ...actual,
    loadLibraryData: async () => ({
      data: { ...actual.emptyLibraryData(), installed: [INSTALLED] },
      dropped: [],
    }),
    saveLibraryData: async () => {},
    loadCachedCatalog: async () => undefined,
  }
})
vi.mock('./java-runtime', async importOriginal => ({
  ...(await importOriginal<typeof import('./java-runtime')>()),
  JavaDetector: class {
    async detect() {}
    getDetected() {
      return []
    }
    getCheckedAt() {
      return undefined
    }
  },
}))

class FakeLocalGameManager extends EventEmitter {
  start = vi.fn(async () => ({ id: 'session-1', state: 'launching' }))
  getStatus() {
    return undefined
  }
}

const REQUEST = {
  map: {},
  player: { name: 'tec27', race: 'z' },
  gameType: GameType.Melee,
  bots: [{ key: 'zzzkbot', race: 'zerg' }],
} as unknown as PracticeLaunchRequest

describe('BotLibrary launches and bot changes', () => {
  let manager: FakeLocalGameManager
  let library: BotLibrary

  beforeEach(() => {
    vi.clearAllMocks()
    manager = new FakeLocalGameManager()
    library = new BotLibrary({
      dataRoot: 'bots',
      localGameLogsRoot: 'logs',
      isDev: true,
      getLocalGameManager: () => manager as unknown as LocalGameManager,
      getParentWindow: () => null,
      onChanged: () => {},
      onInstallProgress: () => {},
    })
  })

  test('a launch refuses a bot whose learning reset is still running', async () => {
    let finishReset!: () => void
    learning.resetLearning.mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          finishReset = resolve
        }),
    )
    const resetting = library.resetLearning('zzzkbot')
    await vi.waitFor(() => expect(learning.resetLearning).toHaveBeenCalledOnce())

    await expect(library.startPracticeGame(REQUEST)).rejects.toThrow(/being changed right now/)
    expect(manager.start).not.toHaveBeenCalled()
    expect(
      learning.ensureWorkingCopy,
      'the profile is untouched while resetting',
    ).not.toHaveBeenCalled()
    expect(library.getSnapshot().inUse, 'a refused launch leases nothing').toEqual([])

    finishReset()
    await resetting

    await library.startPracticeGame(REQUEST)
    expect(manager.start).toHaveBeenCalledOnce()
    expect(library.getSnapshot().inUse).toEqual(['zzzkbot'])
  })

  test('a reset asked for while the bot is in a game refuses without touching its files', async () => {
    await library.startPracticeGame(REQUEST)

    await expect(library.resetLearning('zzzkbot')).rejects.toThrow(/being used by a game/)
    expect(learning.resetLearning).not.toHaveBeenCalled()
  })
})
