import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { InstalledBotRelease, JavaRuntimeInfo } from '../../common/bots/bot-library'
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
const java = vi.hoisted(() => ({
  probeJava: vi.fn(async (path: string): Promise<JavaRuntimeInfo | undefined> => ({
    path,
    major: 21,
    architecture: 'x86_64',
  })),
}))
vi.mock('./java-runtime', async importOriginal => ({
  ...(await importOriginal<typeof import('./java-runtime')>()),
  ...java,
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

describe('BotLibrary added Java installs', () => {
  const JAVA_A = '/java/a/bin/java.exe'
  const JAVA_B = '/java/b/bin/java.exe'
  let library: BotLibrary

  /** Makes the next probe wait until the returned function is called. */
  function holdNextProbe(): () => void {
    let release!: () => void
    const held = new Promise<void>(resolve => {
      release = resolve
    })
    java.probeJava.mockImplementationOnce(async probed => {
      await held
      return { path: probed, major: 21, architecture: 'x86_64' }
    })
    return release
  }

  beforeEach(() => {
    vi.clearAllMocks()
    library = new BotLibrary({
      dataRoot: 'bots',
      localGameLogsRoot: 'logs',
      isDev: true,
      getLocalGameManager: () => new FakeLocalGameManager() as unknown as LocalGameManager,
      getParentWindow: () => null,
      onChanged: () => {},
      onInstallProgress: () => {},
    })
  })

  test('a scan keeps an install added while it runs', async () => {
    await library.addJava(JAVA_A)
    const release = holdNextProbe()
    const scanning = library.detectJava()
    await vi.waitFor(() => expect(java.probeJava).toHaveBeenNthCalledWith(2, JAVA_A))

    await library.addJava(JAVA_B)
    release()
    await scanning

    const { java: snapshot } = library.getSnapshot()
    expect(snapshot.detected.map(d => d.path)).toEqual([JAVA_A, JAVA_B])
    expect(snapshot.added).toEqual([
      { path: JAVA_A, status: 'usable' },
      { path: JAVA_B, status: 'usable' },
    ])
  })

  test('a scan leaves out an install removed while it runs', async () => {
    await library.addJava(JAVA_A)
    const release = holdNextProbe()
    const scanning = library.detectJava()
    await vi.waitFor(() => expect(java.probeJava).toHaveBeenNthCalledWith(2, JAVA_A))

    await library.removeJava(JAVA_A)
    release()
    await scanning

    const { java: snapshot } = library.getSnapshot()
    expect(snapshot.detected).toEqual([])
    expect(snapshot.added).toEqual([])
  })

  test('an install that stops running is kept but marked unusable', async () => {
    await library.addJava(JAVA_A)
    java.probeJava.mockResolvedValueOnce(undefined)
    await library.detectJava()

    const { java: snapshot } = library.getSnapshot()
    expect(snapshot.detected).toEqual([])
    expect(snapshot.added).toEqual([{ path: JAVA_A, status: 'unusable' }])
  })
})
