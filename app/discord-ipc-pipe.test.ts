import { describe, expect, test } from 'vitest'
import { hasDiscordIpcPipe } from './discord-ipc-pipe'

describe('app/discord-ipc-pipe', () => {
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
