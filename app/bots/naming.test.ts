import { describe, expect, test } from 'vitest'
import {
  dedupeInGameNames,
  FALLBACK_BOT_NAME,
  resolveBotLaunchNames,
  sanitizeInGameName,
} from './naming'

describe('app/bots/naming/sanitizeInGameName', () => {
  test('keeps an ordinary name', () => {
    expect(sanitizeInGameName('ZZZKBot')).toBe('ZZZKBot')
  })

  test('drops characters the game cannot show', () => {
    expect(sanitizeInGameName('Кто\u0007Bot ✨')).toBe('Bot')
  })

  test('trims and truncates to 24 characters', () => {
    expect(sanitizeInGameName('  a very long bot name that keeps going  ')).toBe(
      'a very long bot name tha',
    )
  })

  test.each([[undefined], [''], ['   '], ['\u0000\u0001']])(
    'falls back for %s',
    (name: string | undefined) => {
      expect(sanitizeInGameName(name)).toBe(FALLBACK_BOT_NAME)
    },
  )
})

describe('app/bots/naming/dedupeInGameNames', () => {
  test('leaves distinct names alone', () => {
    expect(dedupeInGameNames(['ZZZKBot', 'UAlbertaBot'])).toEqual(['ZZZKBot', 'UAlbertaBot'])
  })

  test('numbers repeats', () => {
    expect(dedupeInGameNames(['ZZZKBot', 'ZZZKBot', 'ZZZKBot'])).toEqual([
      'ZZZKBot',
      'ZZZKBot 2',
      'ZZZKBot 3',
    ])
  })

  test('treats case-insensitive matches as repeats', () => {
    expect(dedupeInGameNames(['ZZZKBot', 'zzzkbot'])).toEqual(['ZZZKBot', 'zzzkbot 2'])
  })

  test('keeps a numbered name within the length limit', () => {
    const long = 'abcdefghijklmnopqrstuvwx'
    const [first, second] = dedupeInGameNames([long, long])
    expect(first).toBe(long)
    expect(second).toBe('abcdefghijklmnopqrstuv 2')
    expect(second.length).toBeLessThanOrEqual(24)
  })
})

describe('app/bots/naming/resolveBotLaunchNames', () => {
  test('keeps a concealed in-game name separate from the real replay name', () => {
    expect(
      resolveBotLaunchNames('Player', [{ inGameName: 'Practice bot', replayName: 'UAlbertaBot' }]),
    ).toEqual([{ inGameName: 'Practice bot', replayName: 'UAlbertaBot' }])
  })

  test('uses the real name in both places for a visible bot', () => {
    expect(resolveBotLaunchNames('Player', [{ replayName: 'UAlbertaBot' }])).toEqual([
      { inGameName: 'UAlbertaBot', replayName: 'UAlbertaBot' },
    ])
  })

  test('dedupes hidden and replay names independently against the human player', () => {
    expect(
      resolveBotLaunchNames('Real Bot', [
        { inGameName: 'Practice bot', replayName: 'Real Bot' },
        { inGameName: 'Practice bot', replayName: 'Real Bot' },
      ]),
    ).toEqual([
      { inGameName: 'Practice bot', replayName: 'Real Bot 2' },
      { inGameName: 'Practice bot 2', replayName: 'Real Bot 3' },
    ])
  })

  test('does not invent replay metadata when an older caller supplies none', () => {
    expect(resolveBotLaunchNames('Player', [{ inGameName: 'Debug bot' }])).toEqual([
      { inGameName: 'Debug bot', replayName: undefined },
    ])
  })
})
