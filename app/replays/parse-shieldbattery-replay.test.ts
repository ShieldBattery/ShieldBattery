import { parseGameId } from './parse-shieldbattery-replay'

function gameIdAsBuffer(gameId: string): Buffer {
  return Buffer.from(gameId.replace(/-/g, ''), 'hex')
}

describe('app/replays/parse-shieldbattery-replays/parseGameId', () => {
  test('UUID with no leading 0s', () => {
    const gameId = '12345678-9abc-def0-1234-56789abcdef0'
    expect(parseGameId(gameIdAsBuffer(gameId))).toBe(gameId)
  })

  test('UUID with leading 0s', () => {
    const gameId = '00005678-0abc-0ef0-0234-06789abcdef0'
    expect(parseGameId(gameIdAsBuffer(gameId))).toBe(gameId)
  })

  test('UUID with leading 0s in last 2 bytes', () => {
    const gameId = '00000000-00bc-00f0-0234-00789abc00f0'
    expect(parseGameId(gameIdAsBuffer(gameId))).toBe(gameId)
  })
})
