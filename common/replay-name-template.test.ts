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
  teams: 'Me+Ally vs Foo+Bar',
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

  test('renders all team names as one piece', () => {
    const template = '{teams} - {map}'
    expect(parseReplayNameTemplate(template)).toEqual([
      { kind: 'token', token: 'teams' },
      { kind: 'text', text: ' - ' },
      { kind: 'token', token: 'map' },
    ])
    expect(serializeReplayNameTemplate(parseReplayNameTemplate(template))).toBe(template)
    expect(renderReplayNameTemplate(template, VALUES)).toBe('Me+Ally vs Foo+Bar - Fighting Spirit')
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

  test('prefixes names Windows reserves for devices', () => {
    expect(renderReplayNameTemplate('{name}', { ...VALUES, name: 'CON' })).toBe('_CON')
    expect(renderReplayNameTemplate('{name}', { ...VALUES, name: 'nul' })).toBe('_nul')
    expect(renderReplayNameTemplate('{name}', { ...VALUES, name: 'Com1.txt' })).toBe('_Com1.txt')
    expect(renderReplayNameTemplate('{map}', { ...VALUES, map: 'aux .' })).toBe('_aux')
    expect(renderReplayNameTemplate('{name}', { ...VALUES, name: 'lpt9' })).toBe('_lpt9')
  })

  test('leaves names that merely contain a device name alone', () => {
    expect(renderReplayNameTemplate('{name}', { ...VALUES, name: 'Con2' })).toBe('Con2')
    expect(renderReplayNameTemplate('{name}', { ...VALUES, name: 'COM10' })).toBe('COM10')
    expect(renderReplayNameTemplate('{name}', { ...VALUES, name: 'xCON' })).toBe('xCON')
    expect(renderReplayNameTemplate('[{name}]', { ...VALUES, name: 'CON' })).toBe('[CON]')
  })

  test('keeps the device name prefix within the length cap', () => {
    const name = renderReplayNameTemplate('{name}', { ...VALUES, name: 'CON.' + 'a'.repeat(200) })
    expect(name.startsWith('_CON.')).toBe(true)
    expect(Array.from(name)).toHaveLength(100)
  })
})
