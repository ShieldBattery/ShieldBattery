import { describe, expect, test } from 'vitest'
import { mapRowTracks } from './map-row-parts'

describe('maps/map-row-parts/mapRowTracks', () => {
  test('gives the link the only track when there are no other columns', () => {
    expect(mapRowTracks([])).toBe('[link-start] minmax(0, 1fr) [link-end]')
  })

  test('names a track for each column, in order after the link', () => {
    expect(mapRowTracks(['controls', 'games', 'star'])).toBe(
      '[link-start] minmax(0, 1fr) [link-end controls-start] auto ' +
        '[controls-end games-start] auto [games-end star-start] auto [star-end]',
    )
  })
})
