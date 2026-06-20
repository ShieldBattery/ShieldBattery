import { describe, expect, it } from 'vitest'
import { makeSbMapId } from '../../../common/maps'
import { computeMatchMapCandidates } from './map-selections'

const m = makeSbMapId
const pool = [m('a'), m('b'), m('c'), m('d')]

describe('server/matchmaking/computeMatchMapCandidates', () => {
  describe('fixed', () => {
    it('returns the full pool and ignores player selections', () => {
      expect(computeMatchMapCandidates('fixed', pool, [[m('a')], [m('b')]])).toEqual(new Set(pool))
    })

    it('returns the (single-map) pool with no selections', () => {
      expect(computeMatchMapCandidates('fixed', [m('a')], [])).toEqual(new Set([m('a')]))
    })
  })

  describe('pick', () => {
    it('returns the intersection of all players selections', () => {
      expect(
        computeMatchMapCandidates('pick', pool, [
          [m('a'), m('b'), m('c')],
          [m('b'), m('c'), m('d')],
        ]),
      ).toEqual(new Set([m('b'), m('c')]))
    })

    it('returns an empty set when selections do not overlap', () => {
      expect(computeMatchMapCandidates('pick', pool, [[m('a')], [m('b')]])).toEqual(new Set())
    })
  })

  describe('veto', () => {
    it('removes vetoed maps from the pool', () => {
      expect(computeMatchMapCandidates('veto', pool, [[m('a')], [m('b')]])).toEqual(
        new Set([m('c'), m('d')]),
      )
    })

    it('returns the full pool when nothing is vetoed', () => {
      expect(computeMatchMapCandidates('veto', pool, [[], []])).toEqual(new Set(pool))
    })

    it('falls back to the least-vetoed maps when the whole pool is vetoed', () => {
      // `a` is vetoed twice, `b`/`c`/`d` once each — fall back to the least-vetoed (b, c, d).
      expect(
        computeMatchMapCandidates('veto', pool, [[m('a'), m('b'), m('c'), m('d')], [m('a')]]),
      ).toEqual(new Set([m('b'), m('c'), m('d')]))
    })
  })
})
