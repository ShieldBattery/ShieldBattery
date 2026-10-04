import { describe, expect, test } from 'vitest'
import { histogramPercentile } from './game-rollback-stats'

describe('models/game-rollback-stats/histogramPercentile', () => {
  test('returns null for an empty histogram', () => {
    expect(histogramPercentile([], 50)).toBeNull()
  })

  test('returns null for an all-zero histogram', () => {
    expect(histogramPercentile([0, 0, 0, 0], 50)).toBeNull()
    expect(histogramPercentile([0, 0, 0, 0], 90)).toBeNull()
  })

  test('returns the only occupied bucket', () => {
    expect(histogramPercentile([0, 0, 7, 0], 50)).toBe(2)
    expect(histogramPercentile([0, 0, 7, 0], 90)).toBe(2)
  })

  test('uses nearest rank, so a rank landing exactly on a bucket boundary stays in that bucket', () => {
    // 10 ticks: p50 is rank 5 (the last tick of bucket 0), p90 is rank 9 (the last of bucket 1).
    expect(histogramPercentile([5, 4, 1], 50)).toBe(0)
    expect(histogramPercentile([5, 4, 1], 90)).toBe(1)
  })

  test('rounds a fractional rank up', () => {
    // 3 ticks: p50 is rank ceil(1.5) = 2, p90 is rank ceil(2.7) = 3.
    expect(histogramPercentile([1, 1, 1], 50)).toBe(1)
    expect(histogramPercentile([1, 1, 1], 90)).toBe(2)
  })

  test('takes the first tick for a single-tick histogram', () => {
    expect(histogramPercentile([0, 1], 50)).toBe(1)
    expect(histogramPercentile([0, 1], 90)).toBe(1)
  })

  test('reports the open-ended last bucket as its index', () => {
    expect(histogramPercentile([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 9], 90)).toBe(11)
    expect(histogramPercentile([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 9], 50)).toBe(11)
  })

  test('skips empty leading and trailing buckets', () => {
    expect(histogramPercentile([0, 0, 50, 40, 10, 0, 0], 50)).toBe(2)
    expect(histogramPercentile([0, 0, 50, 40, 10, 0, 0], 90)).toBe(3)
    expect(histogramPercentile([0, 0, 50, 40, 10, 0, 0], 91)).toBe(4)
  })

  test('handles large tick counts without precision trouble', () => {
    // 1e9 ticks: p90 is rank 9e8, which is exactly the end of bucket 0.
    expect(histogramPercentile([900_000_000, 100_000_000], 90)).toBe(0)
    expect(histogramPercentile([899_999_999, 100_000_001], 90)).toBe(1)
  })
})
