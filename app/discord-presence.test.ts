import {
  clearRichPresence,
  destroyClient,
  DiscordCallError,
  ResultErrorType,
  setApplicationId,
  updateRichPresence,
} from '@shieldbattery/danimoth'
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
const MIN_UPDATE_INTERVAL_MS = 4 * 1000

const LOBBY_ACTIVITY: DiscordActivity = { details: 'My lobby', state: 'Fighting Spirit' }

const mockReaddir = asMockedFunction(readdir as (path: string) => Promise<string[]>)
const mockUpdateRichPresence = asMockedFunction(updateRichPresence)
const mockClearRichPresence = asMockedFunction(clearRichPresence)
const mockSetApplicationId = asMockedFunction(setApplicationId)
const mockDestroyClient = asMockedFunction(destroyClient)

/** Returns an error like the ones the binding rejects with when the SDK reports a failure. */
function callError(errorType: ResultErrorType): DiscordCallError {
  return Object.assign(new Error('ErrorType: 9 Error: '), {
    errorType,
    errorCode: 0,
    retryable: false,
    retryAfter: 0,
  })
}

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
    mockClearRichPresence.mockClear()
    mockSetApplicationId.mockReset()
    mockDestroyClient.mockClear()
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

  test("gives Discord a hash of a party's id, the same for everyone in the party", async () => {
    setDiscordRunning(true)
    mockUpdateRichPresence.mockResolvedValue(undefined)
    presence.start()
    const party = {
      id: 'lobbyId1234567890abcde',
      currentSize: 1,
      maxSize: 2,
      privacy: 'private',
      joinSecret: 'lobby:lobbyId1234567890abcde',
    } as const
    presence.setActivity({ ...LOBBY_ACTIVITY, party })
    await vi.advanceTimersByTimeAsync(0)
    presence.setActivity({
      ...LOBBY_ACTIVITY,
      state: 'Python',
      party: { ...party, currentSize: 2 },
    })
    await vi.advanceTimersByTimeAsync(MIN_UPDATE_INTERVAL_MS)

    const sent = mockUpdateRichPresence.mock.calls.map(([, activity]) => activity)
    expect(sent).toHaveLength(2)
    expect(sent[0].party).toEqual({
      id: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      currentSize: 1,
      maxSize: 2,
      privacy: 'private',
    })
    expect(sent[0].party!.id).not.toContain(party.id)
    expect(sent[1].party!.id).toBe(sent[0].party!.id)
    expect(sent[0].joinSecret).toBe(party.joinSecret)
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
    mockUpdateRichPresence.mockRejectedValueOnce(callError('rpcError')).mockResolvedValue(undefined)
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
    mockUpdateRichPresence.mockRejectedValueOnce(callError('rpcError')).mockResolvedValue(undefined)
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

  test('clears an activity that failed to update', async () => {
    // A failed update may leave an earlier activity showing, so clearing is never skipped after one.
    setDiscordRunning(true)
    mockUpdateRichPresence.mockRejectedValue(callError('rpcError'))
    presence.start()
    presence.setActivity(LOBBY_ACTIVITY)
    await vi.advanceTimersByTimeAsync(0)
    expect(mockUpdateRichPresence).toHaveBeenCalledTimes(1)

    presence.setActivity(null)
    await vi.advanceTimersByTimeAsync(MIN_UPDATE_INTERVAL_MS)
    expect(mockClearRichPresence).toHaveBeenCalledTimes(1)
  })

  test('tries a failed clear again while Discord runs', async () => {
    setDiscordRunning(true)
    mockUpdateRichPresence.mockResolvedValue(undefined)
    mockClearRichPresence.mockImplementationOnce(() => {
      throw new Error('Client is not ready')
    })
    presence.start()
    presence.setActivity(LOBBY_ACTIVITY)
    await vi.advanceTimersByTimeAsync(0)

    presence.setActivity(null)
    await vi.advanceTimersByTimeAsync(MIN_UPDATE_INTERVAL_MS)
    expect(mockClearRichPresence).toHaveBeenCalledTimes(1)

    await runDiscordCheck()
    expect(mockClearRichPresence).toHaveBeenCalledTimes(2)

    await runDiscordCheck()
    expect(mockClearRichPresence).toHaveBeenCalledTimes(2)
  })

  test("doesn't try an activity Discord refused as invalid again", async () => {
    setDiscordRunning(true)
    mockUpdateRichPresence.mockRejectedValue(callError('validationError'))
    presence.start()
    presence.setActivity(LOBBY_ACTIVITY)

    await runDiscordCheck()
    await runDiscordCheck()
    expect(mockUpdateRichPresence).toHaveBeenCalledTimes(1)
  })

  test('leaves presence off when the SDK fails to start', () => {
    mockSetApplicationId.mockImplementation(() => {
      throw new Error('Invalid application ID')
    })

    expect(() => presence.start()).not.toThrow()
    expect(presence.isLoaded).toBe(false)
    expect(mockDestroyClient).toHaveBeenCalledTimes(1)
  })

  test("doesn't hold an update back when the system clock is set back", async () => {
    setDiscordRunning(true)
    mockUpdateRichPresence.mockResolvedValue(undefined)
    presence.start()
    presence.setActivity(LOBBY_ACTIVITY)
    await vi.advanceTimersByTimeAsync(0)
    expect(mockUpdateRichPresence).toHaveBeenCalledTimes(1)

    vi.setSystemTime(Date.now() - 60 * 60 * 1000)
    presence.setActivity({ ...LOBBY_ACTIVITY, state: 'Circuit Breaker' })
    await vi.advanceTimersByTimeAsync(MIN_UPDATE_INTERVAL_MS)
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
