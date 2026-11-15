import { describe, expect, test } from 'vitest'
import { compareAppVersionsNewestFirst } from './bugs'

describe('common/bugs/compareAppVersionsNewestFirst', () => {
  test('compares each component numerically', () => {
    expect(['12.9.0', '12.10.0', '2.0.0', '12.10.2'].sort(compareAppVersionsNewestFirst)).toEqual([
      '12.10.2',
      '12.10.0',
      '12.9.0',
      '2.0.0',
    ])
  })

  test('sorts a version with more components above its prefix', () => {
    expect(['12.4', '12.4.1', '12.4.0'].sort(compareAppVersionsNewestFirst)).toEqual([
      '12.4.1',
      '12.4.0',
      '12.4',
    ])
  })

  test('sorts a suffixed build below the release of the same number', () => {
    expect(['12.4.0-beta.2', '12.4.0', '12.3.9'].sort(compareAppVersionsNewestFirst)).toEqual([
      '12.4.0',
      '12.4.0-beta.2',
      '12.3.9',
    ])
  })

  test('treats equal versions as equal', () => {
    expect(compareAppVersionsNewestFirst('12.4.0', '12.4.0')).toBe(0)
  })

  test('sorts non-numeric components below numeric ones', () => {
    expect(['dev', '1.0.0'].sort(compareAppVersionsNewestFirst)).toEqual(['1.0.0', 'dev'])
  })
})
