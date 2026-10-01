import { describe, expect, test } from 'vitest'
import {
  DEFAULT_REPLAY_NAME_TEMPLATE,
  parseReplayNameTemplate,
  renderReplayNameTemplate,
  ReplayNameToken,
  serializeReplayNameTemplate,
} from './replay-name-template'

const VALUES: Record<ReplayNameToken, string> = {
  date: '2026-09-29',
  time: '204105',
  map: 'Fighting Spirit',
  name: 'Me',
  opponents: 'Foo+Bar',
  race: 'Z',
  opponentRaces: 'TP',
  format: '2v2',
  matchup: 'ZPvTP',
}

describe('common/replay-name-template/parseReplayNameTemplate', () => {
  test('splits tokens and text', () => {
    expect(parseReplayNameTemplate('[SB]{time}-{map}')).toEqual([
      { kind: 'text', text: '[SB]' },
      { kind: 'token', token: 'time' },
      { kind: 'text', text: '-' },
      { kind: 'token', token: 'map' },
    ])
  })

  test('keeps unknown placeholders as text', () => {
    expect(parseReplayNameTemplate('a{nope}{map}')).toEqual([
      { kind: 'text', text: 'a{nope}' },
      { kind: 'token', token: 'map' },
    ])
  })

  test('round-trips through serialize', () => {
    const template = '{date} {matchup} vs {opponents}{format}'
    expect(serializeReplayNameTemplate(parseReplayNameTemplate(template))).toBe(template)
  })
})

describe('common/replay-name-template/renderReplayNameTemplate', () => {
  test('renders the default template', () => {
    expect(renderReplayNameTemplate(DEFAULT_REPLAY_NAME_TEMPLATE, VALUES)).toBe(
      '[SB]204105-Fighting Spirit',
    )
  })

  test('strips characters Windows rejects, from text and values alike', () => {
    expect(renderReplayNameTemplate('a:b/c\\d|{map}', { ...VALUES, map: '\x03Map<1>?' })).toBe(
      'abcdMap1',
    )
  })

  test('drops trailing dots and spaces', () => {
    expect(renderReplayNameTemplate('{name}. . ', VALUES)).toBe('Me')
  })

  test('falls back to the default when nothing is left', () => {
    expect(renderReplayNameTemplate('{race}::', { ...VALUES, race: '' })).toBe(
      '[SB]204105-Fighting Spirit',
    )
  })

  test('caps the length', () => {
    expect(renderReplayNameTemplate('{map}', { ...VALUES, map: 'x'.repeat(300) })).toHaveLength(100)
  })
})
