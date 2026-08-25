import { describe, expect, test } from 'vitest'
import {
  readFilterParams,
  urlHasRememberedFilters,
  withFilterParams,
} from './use-remembered-filters'

describe('urlHasRememberedFilters', () => {
  test('a URL carrying none of the surface params seeds from the saved set', () => {
    expect(urlHasRememberedFilters({ sort: '', duration: '', includeShort: '' })).toBe(false)
  })

  test('a URL carrying any one of them is authoritative for all of them', () => {
    expect(urlHasRememberedFilters({ sort: '', duration: 'under10', includeShort: '' })).toBe(true)
  })

  test('no surface params at all seeds from the saved set', () => {
    expect(urlHasRememberedFilters({})).toBe(false)
  })
})

describe('readFilterParams', () => {
  test('reads the named params, omitting unset ones', () => {
    expect(
      readFilterParams('?sort=oldest&duration=', ['sort', 'duration', 'includeShort']),
    ).toEqual({ sort: 'oldest' })
  })

  test('ignores params the surface does not remember', () => {
    expect(readFilterParams('?sort=oldest&mapName=lost+temple', ['sort', 'duration'])).toEqual({
      sort: 'oldest',
    })
  })

  test('an empty search reads as nothing saved', () => {
    expect(readFilterParams('', ['sort', 'duration'])).toEqual({})
  })
})

describe('withFilterParams', () => {
  test('writes the seeded values into the search string', () => {
    const search = withFilterParams('', { duration: 'under10', sort: 'oldest' })

    expect(new URLSearchParams(search).get('duration')).toBe('under10')
    expect(new URLSearchParams(search).get('sort')).toBe('oldest')
  })

  test('preserves params the surface does not remember', () => {
    const search = withFilterParams('?mapName=lost+temple', { duration: 'under10' })

    expect(new URLSearchParams(search).get('mapName')).toBe('lost temple')
    expect(new URLSearchParams(search).get('duration')).toBe('under10')
  })

  test('overwrites an existing value rather than appending a second copy', () => {
    const search = withFilterParams('?duration=over30', { duration: 'under10' })

    expect(new URLSearchParams(search).getAll('duration')).toEqual(['under10'])
  })

  test('produces a leading ? only when something is left', () => {
    expect(withFilterParams('', { duration: 'under10' }).startsWith('?')).toBe(true)
    expect(withFilterParams('', {})).toBe('')
  })
})
