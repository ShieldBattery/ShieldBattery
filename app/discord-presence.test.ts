import { updateRichPresence } from '@shieldbattery/danimoth'
import { readdir } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DiscordActivity } from '../common/discord-presence'
import { asMockedFunction } from '../common/testing/mocks'
import { DiscordPresence, hasDiscordIpcPipe } from './discord-presence'

vi.mock('@shieldbattery/danimoth', () => ({
  loadSdk: vi.fn(),
  sdkVersion: () => ({ major: 1, minor: 10, patch: 19337 }),
  createClient: vi.fn(() => ({})),
  destroyClient: vi.fn(),
  setApplicationId: vi.fn(),
  registerLaunchCommand: vi.fn(() => true),
  runCallbacks: vi.fn(),
  updateRichPresence: vi.fn(),
  clearRichPresence: vi.fn(),
}))
vi.mock('node:fs/promises', async importOriginal => ({
  ...(await importOriginal<typeof import('node:fs/promises')>()),
  readdir: vi.fn(),
}))
vi.mock('./logger', () => ({
  default: { log: () => {}, verbose: () => {}, info: () => {}, warning: () => {}, error: () => {} },
}))

const DISCORD_CHECK_INTERVAL_MS = 15 * 1000

const LOBBY_ACTIVITY: DiscordActivity = { details: 'My lobby', state: 'Fighting Spirit' }

const mockReaddir = asMockedFunction(readdir as (path: string) => Promise<string[]>)
const mockUpdateRichPresence = asMockedFunction(updateRichPresence)

function setDiscordRunning(running: boolean) {
  mockReaddir.mockResolvedValue(running ? ['InitShutdown', 'discord-ipc-0'] : ['InitShutdown'])
}

/** Runs the next check for Discord, and the publish it schedules if any. */
async function runDiscordCheck() {
  await vi.advanceTimersByTimeAsync(DISCORD_CHECK_INTERVAL_MS)
  // Fake timers count a zero delay set while timers run as 1 ms, so the check's publish is 1 ms on.
  await vi.advanceTimersByTimeAsync(1)
}

describe('app/discord-presence/hasDiscordIpcPipe', () => {
  test('finds the Discord desktop app by its pipe', () => {
    expect(hasDiscordIpcPipe(['InitShutdown', 'discord-ipc-0', 'lsass'])).toBe(true)
    // Discord takes the next free number when an earlier one is in use, e.g. by a second client.
    expect(hasDiscordIpcPipe(['discord-ipc-3'])).toBe(true)
  })

  test("doesn't find it without the pipe", () => {
    expect(hasDiscordIpcPipe([])).toBe(false)
    expect(hasDiscordIpcPipe(['InitShutdown', 'lsass', 'mojo.1234.5678'])).toBe(false)
  })

  test("doesn't mistake other pipes with similar names for it", () => {
    expect(hasDiscordIpcPipe(['discord-ipc-10', 'discord-ipc-', 'my-discord-ipc-0'])).toBe(false)
  })
})

describe('app/discord-presence/DiscordPresence', () => {
  let presence: DiscordPresence

  beforeEach(() => {
    vi.useFakeTimers()
    mockUpdateRichPresence.mockReset()
    presence = new DiscordPresence({
      sdkPath: 'C:\\fake\\discord_partner_sdk.dll',
      applicationId: '1',
      launchCommand: undefined,
      onJoinLobby: () => {},
    })
  })

  afterEach(() => {
    presence.dispose()
    vi.useRealTimers()
  })

  test('sends an unchanged activity once', async () => {
    setDiscordRunning(true)
    mockUpdateRichPresence.mockResolvedValue(undefined)
    presence.start()
    presence.setActivity(LOBBY_ACTIVITY)

    await runDiscordCheck()
    await runDiscordCheck()
    expect(mockUpdateRichPresence).toHaveBeenCalledTimes(1)
  })

  test('tries a failed activity again while Discord runs', async () => {
    // Right after Discord starts, its pipe exists before it takes the SDK's connection.
    setDiscordRunning(true)
    mockUpdateRichPresence
      .mockRejectedValueOnce(new Error('ErrorType: 9'))
      .mockResolvedValue(undefined)
    presence.start()
    presence.setActivity(LOBBY_ACTIVITY)
    await vi.advanceTimersByTimeAsync(0)
    expect(mockUpdateRichPresence).toHaveBeenCalledTimes(1)

    await runDiscordCheck()
    expect(mockUpdateRichPresence).toHaveBeenCalledTimes(2)

    await runDiscordCheck()
    expect(mockUpdateRichPresence).toHaveBeenCalledTimes(2)
  })

  test('waits for Discord to start before trying a failed activity again', async () => {
    setDiscordRunning(false)
    mockUpdateRichPresence
      .mockRejectedValueOnce(new Error('ErrorType: 9'))
      .mockResolvedValue(undefined)
    presence.start()
    presence.setActivity(LOBBY_ACTIVITY)
    await runDiscordCheck()
    expect(mockUpdateRichPresence).toHaveBeenCalledTimes(1)

    setDiscordRunning(true)
    await runDiscordCheck()
    expect(mockUpdateRichPresence).toHaveBeenCalledTimes(2)
  })

  test('sends the activity again when Discord restarts', async () => {
    setDiscordRunning(true)
    mockUpdateRichPresence.mockResolvedValue(undefined)
    presence.start()
    presence.setActivity(LOBBY_ACTIVITY)
    await vi.advanceTimersByTimeAsync(0)

    setDiscordRunning(false)
    await runDiscordCheck()
    setDiscordRunning(true)
    await runDiscordCheck()
    expect(mockUpdateRichPresence).toHaveBeenCalledTimes(2)
  })

  test("doesn't try an activity the binding rejected again", async () => {
    setDiscordRunning(true)
    mockUpdateRichPresence.mockImplementation(() => {
      throw new TypeError('expected string')
    })
    presence.start()
    presence.setActivity(LOBBY_ACTIVITY)

    await runDiscordCheck()
    await runDiscordCheck()
    expect(mockUpdateRichPresence).toHaveBeenCalledTimes(1)
  })
})
