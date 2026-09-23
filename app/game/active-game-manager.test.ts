import { EventEmitter } from 'node:events'
import { promises as fsPromises } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GameLaunchConfig } from '../../common/games/game-launch-config'
import { NetcodeV2ServerSetup } from '../../common/games/netcode-v2'
import { InGameReportRequest } from '../../common/ipc'
import { makeSbUserId, SbUserId } from '../../common/users/sb-user-id'
import { ActiveGameManager } from './active-game-manager'
import { checkStarcraftPath } from './check-starcraft-path'

const { verifyGame, electronApp } = vi.hoisted(() => ({
  verifyGame: vi.fn<() => Promise<void>>(),
  electronApp: { getAppPath: () => 'C:\\fake-app', isPackaged: true },
}))
vi.mock('virtual:sb-security-impl', () => ({ verifyGame }))

// ActiveGameManager pulls in Electron (and modules that initialize against a real Electron
// process) at module scope; these are irrelevant to the keypair-lifecycle behavior under test, so
// they're stubbed just far enough for the module to load. The launch path is pinned mid-flight
// (`checkStarcraftPath` never resolves) so no game process is ever spawned and no
// launch-error/exit handler can clear the active game out from under the test.
vi.mock('electron', () => ({
  app: electronApp,
  screen: {},
}))
vi.mock('electron-is-dev', () => ({ default: false }))
vi.mock('@shieldbattery/windows-registry', () => ({
  HKCU: 'HKCU',
  REG_SZ: 'REG_SZ',
  WindowsRegistry: class {},
}))
vi.mock('../logger', () => ({
  default: { verbose: () => {}, warning: () => {}, error: () => {} },
}))
vi.mock('../log-paths', () => ({ gameLogBaseName: () => 'game' }))
vi.mock('../settings', () => ({
  LocalSettingsManager: class {},
  ScrSettingsManager: class {},
}))
vi.mock('./map-store', () => ({ MapStore: class {} }))
vi.mock('./check-starcraft-path', () => ({
  checkStarcraftPath: vi.fn(() => new Promise(() => {})),
}))

function makeManager(): ActiveGameManager {
  return makeManagerWithSettings().manager
}

function makeManagerWithSettings() {
  // The launch path's very first step awaits the local settings; pinning that await keeps the
  // launch permanently in flight (see the `checkStarcraftPath` mock note above), so the launch
  // outcome handlers never race the assertions. Settings changes still reach the manager through
  // `change` events.
  const localSettings = Object.assign(new EventEmitter(), { get: () => new Promise(() => {}) })
  const scrSettings = {
    get: () => new Promise(() => {}),
    syncWithGameSettingsFile: vi.fn(async () => {}),
  }
  const manager = new ActiveGameManager({} as any, localSettings as any, scrSettings as any)
  return { manager, localSettings, scrSettings }
}

function configFor(gameId: string): GameLaunchConfig {
  // `map` must exist for the replay-config checks status reporting runs through.
  return { setup: { gameId, useNetcodeV2: true, map: {} } } as unknown as GameLaunchConfig
}

function replayConfigFor(gameId: string): GameLaunchConfig {
  return {
    setup: { gameId, map: { isReplay: true, path: `C:\\replays\\${gameId}.rep` } },
  } as unknown as GameLaunchConfig
}

function setupFor(clientPubkey: string | undefined): NetcodeV2ServerSetup {
  return { clientPubkey } as NetcodeV2ServerSetup
}

describe('ActiveGameManager packaged launch checks', () => {
  beforeEach(() => {
    vi.spyOn(fsPromises, 'access').mockResolvedValue(undefined)
    vi.mocked(checkStarcraftPath).mockClear()
    verifyGame.mockReset().mockResolvedValue(undefined)
  })

  afterEach(() => {
    electronApp.isPackaged = true
    vi.restoreAllMocks()
  })

  function launch() {
    const localSettings = Object.assign(new EventEmitter(), {
      get: async () => ({ starcraftPath: 'C:\\StarCraft', launch32Bit: false }),
    })
    const manager = new ActiveGameManager({} as any, localSettings as any, {} as any)
    const statuses: Array<{ state: string; extra?: unknown }> = []
    manager.on('gameStatus', status => statuses.push(status))
    manager.setGameConfig(configFor('launch-check'))
    return { manager, statuses }
  }

  it('checks a packaged DLL before proceeding to StarCraft setup', async () => {
    electronApp.isPackaged = true
    launch()
    await vi.waitFor(() => expect(checkStarcraftPath).toHaveBeenCalledWith('C:\\StarCraft'))
    expect(verifyGame).toHaveBeenCalledExactlyOnceWith(
      expect.stringMatching(/shieldbattery_64\.dll$/),
    )
    expect(verifyGame.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(checkStarcraftPath).mock.invocationCallOrder[0],
    )
  })

  it('fails a packaged launch when the DLL check rejects', async () => {
    electronApp.isPackaged = true
    const failure = new Error('DLL check failed')
    verifyGame.mockRejectedValue(failure)
    const { manager, statuses } = launch()
    await vi.waitFor(() =>
      expect(statuses).toContainEqual(
        expect.objectContaining({
          state: 'error',
          extra: failure,
        }),
      ),
    )
    expect(manager.getStatus()).toBeNull()
    expect(checkStarcraftPath).not.toHaveBeenCalled()
  })

  it('allows unpackaged DLLs even when electron-is-dev is false', async () => {
    electronApp.isPackaged = false
    verifyGame.mockRejectedValue(new Error('development DLL'))
    launch()
    await vi.waitFor(() => expect(checkStarcraftPath).toHaveBeenCalledWith('C:\\StarCraft'))
    expect(verifyGame).not.toHaveBeenCalled()
  })
})

describe('ActiveGameManager netcode v2 keypair lifecycle', () => {
  let manager: ActiveGameManager
  let commands: Array<[string, string, ...any[]]>

  beforeEach(() => {
    manager = makeManager()
    commands = []
    manager.on('gameCommand', (gameId, command, ...args) => {
      commands.push([gameId, command, ...args])
    })
  })

  function deliveredSetups(
    gameId: string,
  ): Array<NetcodeV2ServerSetup & { clientPrivateKey: string }> {
    return commands
      .filter(([id, command]) => id === gameId && command === 'netcodeV2Setup')
      .map(([, , setup]) => setup)
  }

  function deliveredSetup(gameId: string): NetcodeV2ServerSetup & { clientPrivateKey: string } {
    const delivered = deliveredSetups(gameId)
    expect(delivered.length, `netcodeV2Setup was delivered for ${gameId}`).toBeGreaterThan(0)
    return delivered[delivered.length - 1]
  }

  it('resolves the echoed pubkey again for a requeued match under a new game id', () => {
    // The failed-load requeue flow: the player queues once (one generated keypair), the first
    // match adopts it, loading fails, and the server requeues the player with the SAME pubkey
    // (its queue entry survives) -- so the next match's handoff echoes that pubkey under a brand
    // new game id, which deliberately carries nothing over from the failed game.
    const pubkey = manager.generateNetcodeV2SessionKeys()

    manager.setGameConfig(configFor('game-1'))
    manager.setNetcodeV2Setup('game-1', setupFor(pubkey))
    expect(deliveredSetup('game-1').clientPrivateKey).toBeDefined()

    // Loading fails; the server cancels the game client-side.
    manager.clearGameConfig('game-1')

    manager.setGameConfig(configFor('game-2'))
    manager.setNetcodeV2Setup('game-2', setupFor(pubkey))

    const second = deliveredSetup('game-2')
    expect(second.clientPrivateKey).toBe(deliveredSetup('game-1').clientPrivateKey)
    expect(manager.getStatus()?.state).not.toBe('error')
  })

  it('a relaunch of the same game id reuses the adopted keypair without a fresh handoff lookup', () => {
    const pubkey = manager.generateNetcodeV2SessionKeys()

    manager.setGameConfig(configFor('game-1'))
    manager.setNetcodeV2Setup('game-1', setupFor(pubkey))
    const first = deliveredSetup('game-1')

    // The same game id relaunches (e.g. the process died before init); the adopted keypair and
    // handoff carry forward on the game itself, no ring lookup involved. Assert on a genuinely
    // second delivery -- a single delivery re-read would vacuously "match" itself.
    manager.setGameConfig(configFor('game-1'))
    manager.setNetcodeV2Setup('game-1', setupFor(pubkey))
    const setups = deliveredSetups('game-1')
    expect(setups.length).toBe(2)
    expect(setups[1].clientPrivateKey).toBe(first.clientPrivateKey)
  })

  it('quits the game with an explicit error when no keypair can be adopted', () => {
    const statuses: Array<{ state: string; extra?: unknown }> = []
    manager.on('gameStatus', status => statuses.push(status))

    manager.setGameConfig(configFor('game-1'))
    manager.setNetcodeV2Setup('game-1', setupFor('pubkey-nobody-generated'))

    expect(commands).toContainEqual(['game-1', 'quit'])
    expect(manager.getStatus()).toBeNull()
    const errorStatus = statuses.find(status => status.state === 'error')
    expect(errorStatus, 'an error status was emitted').toBeDefined()
    expect(String(errorStatus!.extra)).toContain('no adoptable keypair (noKeysGenerated)')
  })
})

describe('ActiveGameManager block list updates', () => {
  let manager: ActiveGameManager
  let commands: Array<[string, string, ...any[]]>
  let blockRequests: Array<[string, SbUserId, boolean]>

  beforeEach(() => {
    manager = makeManager()
    commands = []
    blockRequests = []
    manager.on('gameCommand', (gameId, command, ...args) => {
      commands.push([gameId, command, ...args])
    })
    manager.on('setUserBlocked', (gameId, userId, blocked) => {
      blockRequests.push([gameId, userId, blocked])
    })
  })

  it('forwards block list changes to the active game only', () => {
    manager.setBlockedUsers([makeSbUserId(5)])
    expect(commands).toEqual([])

    manager.setGameConfig(configFor('game-1'))
    manager.setBlockedUsers([makeSbUserId(5), makeSbUserId(6)])
    expect(commands).toContainEqual(['game-1', 'blockedUsers', [makeSbUserId(5), makeSbUserId(6)]])
  })

  it('relays in-game block requests and their failures for the active game only', () => {
    manager.setGameConfig(configFor('game-1'))

    manager.handleSetUserBlocked('game-0', makeSbUserId(5), true)
    manager.handleSetUserBlocked('game-1', makeSbUserId(6), true)
    expect(blockRequests).toEqual([['game-1', makeSbUserId(6), true]])

    const failure = { userId: makeSbUserId(6), blocked: true, reason: 'limitReached' as const }
    manager.blockRequestFailed('game-0', failure)
    manager.blockRequestFailed('game-1', failure)
    expect(commands.filter(([, command]) => command === 'blockRequestFailed')).toEqual([
      ['game-1', 'blockRequestFailed', failure],
    ])
  })

  it('relays in-game report requests and their results for the active game only', () => {
    const reportRequests: Array<[string, InGameReportRequest]> = []
    manager.on('reportPlayer', (gameId, request) => {
      reportRequests.push([gameId, request])
    })
    manager.setGameConfig(configFor('game-1'))

    const request = { userId: makeSbUserId(6), reason: 'griefing' as const, gameSeconds: 754 }
    manager.handleReportPlayer('game-0', request)
    manager.handleReportPlayer('game-1', request)
    expect(reportRequests).toEqual([['game-1', request]])

    const result = { userId: makeSbUserId(6), result: 'rateLimited' as const }
    manager.reportResult('game-0', result)
    manager.reportResult('game-1', result)
    expect(commands.filter(([, command]) => command === 'reportResult')).toEqual([
      ['game-1', 'reportResult', result],
    ])
  })
})

describe('ActiveGameManager watch-only games', () => {
  let manager: ActiveGameManager
  let localSettings: EventEmitter
  let scrSettings: { syncWithGameSettingsFile: ReturnType<typeof vi.fn> }
  let commands: Array<[string, string, ...any[]]>

  beforeEach(() => {
    ;({ manager, localSettings, scrSettings } = makeManagerWithSettings())
    commands = []
    manager.on('gameCommand', (gameId, command, ...args) => {
      commands.push([gameId, command, ...args])
    })
  })

  function setKeepReplays(keepReplaysAlongsideGames: boolean) {
    localSettings.emit('change', { keepReplaysAlongsideGames })
  }

  function quitsSentTo(gameId: string) {
    return commands.filter(([id, command]) => id === gameId && command === 'quit')
  }

  async function settingsSyncCount() {
    // The sync is started from a resolved promise, so let it run before counting.
    await Promise.resolve()
    await Promise.resolve()
    return scrSettings.syncWithGameSettingsFile.mock.calls.length
  }

  describe('with replays kept alongside other games', () => {
    beforeEach(() => setKeepReplays(true))

    it('keeps a replay running when a networked game launches', () => {
      expect(manager.setGameConfig(replayConfigFor('replay-1'))).toBe('replay-1')
      expect(manager.setGameConfig(configFor('game-1'))).toBe('game-1')

      expect(quitsSentTo('replay-1')).toEqual([])
      expect(manager.getStatus('replay-1')?.state).toBe('launching')
      expect(manager.getStatus()?.id).toBe('game-1')
    })

    it('launches a replay alongside a running networked game', () => {
      manager.setGameConfig(configFor('game-1'))
      manager.handleGameStart('game-1')
      expect(manager.setGameConfig(replayConfigFor('replay-1'))).toBe('replay-1')

      expect(commands).toEqual([])
      expect(manager.getStatus()).toMatchObject({ id: 'game-1', state: 'playing' })
      expect(manager.getStatus('replay-1')).toMatchObject({ state: 'launching', isReplay: true })
    })

    it('handles a replay exiting without disturbing the networked game', async () => {
      const statuses: Array<{ id: string; state: string }> = []
      manager.on('gameStatus', status => statuses.push(status))

      manager.setGameConfig(replayConfigFor('replay-1'))
      manager.handleGameStart('replay-1')
      manager.setGameConfig(configFor('game-1'))
      manager.handleGameStart('game-1')
      statuses.length = 0

      manager.handleGameExit('replay-1', 0)

      expect(statuses).toEqual([expect.objectContaining({ id: 'replay-1', state: 'unknown' })])
      expect(manager.getStatus('replay-1')).toBeNull()
      expect(manager.getStatus()).toMatchObject({ id: 'game-1', state: 'playing' })
      expect(commands).toEqual([])
      // The networked game still runs, so the settings file isn't read back yet.
      expect(await settingsSyncCount()).toBe(0)

      manager.handleGameResult('game-1', {}, 1000)
      expect(manager.getStatus()?.state).toBe('hasResult')
      manager.handleGameExit('game-1', 0)
      expect(await settingsSyncCount()).toBe(1)
    })

    it('handles a networked game exiting while a replay keeps running', async () => {
      const resends: unknown[] = []
      manager.on('resendReplay', request => resends.push(request))

      manager.setGameConfig(replayConfigFor('replay-1'))
      manager.handleGameStart('replay-1')
      const config = configFor('game-1')
      manager.setGameConfig({
        ...config,
        localUser: { id: makeSbUserId(1) },
        setup: { ...config.setup, resultCode: 'code' },
      } as unknown as GameLaunchConfig)
      manager.handleGameStart('game-1')
      manager.handleGameResult('game-1', {}, 1000, 'C:\\temp\\game-1.rep')
      manager.handleGameFinished('game-1')

      manager.handleGameExit('game-1', 0)

      expect(manager.getStatus()).toBeNull()
      expect(resends).toEqual([expect.objectContaining({ gameId: 'game-1' })])
      expect(manager.getStatus('replay-1')?.state).toBe('playing')
      expect(quitsSentTo('replay-1')).toEqual([])
      expect(await settingsSyncCount()).toBe(0)

      manager.handleGameExit('replay-1', 0)
      expect(await settingsSyncCount()).toBe(1)
    })

    it.each(['ReplayRejected', 'ReplaySeedMissing'])(
      'sends diagnostics instead of resending a replay the server rejected (%s)',
      code => {
        const resends: unknown[] = []
        const diagnostics: unknown[] = []
        manager.on('resendReplay', request => resends.push(request))
        manager.on('replayDiagnosticsRequested', request => diagnostics.push(request))

        const config = configFor('game-1')
        manager.setGameConfig({
          ...config,
          localUser: { id: makeSbUserId(1) },
          setup: { ...config.setup, resultCode: 'code' },
        } as unknown as GameLaunchConfig)
        manager.handleGameStart('game-1')
        manager.handleGameResult('game-1', {}, 1000, 'C:\\temp\\game-1.rep')
        manager.handleReplayRejected('game-1', code)
        // Requested only once the game exits, so the report carries its complete log.
        expect(diagnostics).toEqual([])
        manager.handleGameFinished('game-1')

        manager.handleGameExit('game-1', 0)

        expect(resends).toEqual([])
        expect(diagnostics).toEqual([
          { gameId: 'game-1', replayPath: 'C:\\temp\\game-1.rep', code },
        ])
      },
    )

    it('runs two replays at once', () => {
      manager.setGameConfig(replayConfigFor('replay-1'))
      manager.setGameConfig(replayConfigFor('replay-2'))

      expect(commands).toEqual([])
      expect(manager.getStatus('replay-1')?.state).toBe('launching')
      expect(manager.getStatus('replay-2')?.state).toBe('launching')
    })

    it('still quits a previous networked game when another one launches', () => {
      manager.setGameConfig(replayConfigFor('replay-1'))
      manager.setGameConfig(configFor('game-1'))
      manager.setGameConfig(configFor('game-2'))

      expect(commands).toEqual([['game-1', 'quit']])
      expect(manager.getStatus()?.id).toBe('game-2')
      expect(manager.getStatus('replay-1')?.state).toBe('launching')
    })

    it('configures a connecting replay instead of quitting it', () => {
      manager.setGameConfig(replayConfigFor('replay-1'))
      manager.setGameConfig(configFor('game-1'))

      // Connecting goes on to read the local settings, which never resolve here; the status
      // update before that read is what tells a tracked game apart from an abandoned one.
      manager.handleGameConnected('replay-1').catch(() => {})

      expect(quitsSentTo('replay-1')).toEqual([])
      expect(manager.getStatus('replay-1')?.state).toBe('configuring')
    })

    it('sends block list changes to every game', () => {
      manager.setGameConfig(replayConfigFor('replay-1'))
      manager.setGameConfig(configFor('game-1'))

      manager.setBlockedUsers([makeSbUserId(5)])

      expect(commands).toEqual([
        ['game-1', 'blockedUsers', [makeSbUserId(5)]],
        ['replay-1', 'blockedUsers', [makeSbUserId(5)]],
      ])
    })

    it('quits only the replays as the app exits', () => {
      manager.setGameConfig(replayConfigFor('replay-1'))
      manager.setGameConfig(replayConfigFor('replay-2'))
      manager.setGameConfig(configFor('game-1'))

      manager.quitWatchOnlyGamesOnAppExit()

      expect(commands).toEqual([
        ['replay-1', 'quit'],
        ['replay-2', 'quit'],
      ])
    })
  })

  describe('with one game at a time', () => {
    beforeEach(() => setKeepReplays(false))

    it('quits a running replay when a networked game launches', () => {
      manager.setGameConfig(replayConfigFor('replay-1'))
      manager.setGameConfig(configFor('game-1'))

      expect(commands).toEqual([['replay-1', 'quit']])
      expect(manager.getStatus('replay-1')).toBeNull()
      expect(manager.getStatus()?.id).toBe('game-1')
    })

    it('replaces a running replay with a new one', () => {
      manager.setGameConfig(replayConfigFor('replay-1'))
      manager.setGameConfig(replayConfigFor('replay-2'))

      expect(commands).toEqual([['replay-1', 'quit']])
      expect(manager.getStatus('replay-1')).toBeNull()
      expect(manager.getStatus('replay-2')?.state).toBe('launching')
    })

    it('refuses a replay while a networked game runs, without touching the game', () => {
      const statuses: unknown[] = []
      manager.setGameConfig(configFor('game-1'))
      manager.handleGameStart('game-1')
      manager.on('gameStatus', status => statuses.push(status))

      expect(manager.setGameConfig(replayConfigFor('replay-1'))).toBeNull()

      expect(commands).toEqual([])
      expect(statuses).toEqual([])
      expect(manager.getStatus('replay-1')).toBeNull()
      expect(manager.getStatus()).toMatchObject({ id: 'game-1', state: 'playing' })
    })
  })
})

describe('ActiveGameManager graceful stop', () => {
  let manager: ActiveGameManager
  let commands: Array<[string, string, ...any[]]>

  beforeEach(() => {
    vi.useFakeTimers()
    manager = makeManager()
    commands = []
    manager.on('gameCommand', (gameId, command, ...args) => {
      commands.push([gameId, command, ...args])
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('lets a game that has its result exit on its own before quitting it', async () => {
    manager.setGameConfig(configFor('game-1'))
    manager.handleGameResult('game-1', {}, 0)
    commands.length = 0

    // The launch is pinned in flight, so the game never exits and this stop never settles.
    manager.stop(true).catch(() => {})
    await vi.advanceTimersByTimeAsync(1999)
    expect(commands, 'no leave request and no quit yet').toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(commands).toEqual([['game-1', 'quit']])
  })
})
