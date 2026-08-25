import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GameLaunchConfig } from '../../common/games/game-launch-config'
import { NetcodeV2ServerSetup } from '../../common/games/netcode-v2'
import { ActiveGameManager } from './active-game-manager'

// ActiveGameManager pulls in Electron (and modules that initialize against a real Electron
// process) at module scope; these are irrelevant to the keypair-lifecycle behavior under test, so
// they're stubbed just far enough for the module to load. The launch path is pinned mid-flight
// (`checkStarcraftPath` never resolves) so no game process is ever spawned and no
// launch-error/exit handler can clear the active game out from under the test.
vi.mock('electron', () => ({ app: { getAppPath: () => 'C:\\fake-app' }, screen: {} }))
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
  checkStarcraftPath: () => new Promise(() => {}),
}))

function makeManager(): ActiveGameManager {
  // The launch path's very first step awaits the local settings; pinning that await keeps the
  // launch permanently in flight (see the `checkStarcraftPath` mock note above), so the launch
  // outcome handlers never race the assertions.
  const neverSettings = { get: () => new Promise(() => {}) }
  return new ActiveGameManager({} as any, neverSettings as any, neverSettings as any)
}

function configFor(gameId: string): GameLaunchConfig {
  // `map` must exist for the replay-config checks status reporting runs through.
  return { setup: { gameId, useNetcodeV2: true, map: {} } } as unknown as GameLaunchConfig
}

function setupFor(clientPubkey: string | undefined): NetcodeV2ServerSetup {
  return { clientPubkey } as NetcodeV2ServerSetup
}

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

  function deliveredSetup(gameId: string): NetcodeV2ServerSetup & { clientPrivateKey: string } {
    const delivered = commands.find(
      ([id, command]) => id === gameId && command === 'netcodeV2Setup',
    )
    expect(delivered, `netcodeV2Setup was delivered for ${gameId}`).toBeDefined()
    return delivered![2]
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
    // handoff carry forward on the game itself, no ring lookup involved.
    manager.setGameConfig(configFor('game-1'))
    manager.setNetcodeV2Setup('game-1', setupFor(pubkey))
    expect(deliveredSetup('game-1').clientPrivateKey).toBe(first.clientPrivateKey)
  })

  it('quits the game with an explicit error when no keypair can be adopted', () => {
    manager.setGameConfig(configFor('game-1'))
    manager.setNetcodeV2Setup('game-1', setupFor('pubkey-nobody-generated'))

    expect(commands).toContainEqual(['game-1', 'quit'])
    expect(manager.getStatus()).toBeNull()
  })
})
