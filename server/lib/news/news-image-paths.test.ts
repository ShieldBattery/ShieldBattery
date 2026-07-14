import { describe, expect, test } from 'vitest'
import { smallVariantPath } from './news-image-paths'

describe('news-image-paths', () => {
  describe('smallVariantPath', () => {
    // These cases must match the `small_variant_path` tests in server-rs's news.rs, since the two
    // implementations derive URLs for the same stored files and drift between them would 404 the
    // small cover variant.
    test.each([
      ['news-images/ab/cd/xyz.jpg', 'news-images/ab/cd/xyz_0.5x.jpg'],
      ['news-images/ab/cd/archive.tar.gz', 'news-images/ab/cd/archive.tar_0.5x.gz'],
      ['news-images/ab/cd/noext', 'news-images/ab/cd/noext_0.5x'],
      ['news-images/ab.cd/noext', 'news-images/ab.cd/noext_0.5x'],
      ['noext', 'noext_0.5x'],
    ])('%s -> %s', (input, expected) => {
      expect(smallVariantPath(input)).toBe(expected)
    })
  })
})
