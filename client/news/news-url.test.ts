import { describe, expect, test } from 'vitest'
import { fromRouteNewsPostId, RouteNewsPostId, toRouteNewsPostId, urlForNewsPost } from './news-url'

const UUID = '5eed0000-0000-0000-0000-000000000023'

describe('news/news-url', () => {
  describe('toRouteNewsPostId/fromRouteNewsPostId', () => {
    test('round-trips a uuid through the pretty id encoding', () => {
      const routeId = toRouteNewsPostId(UUID)
      expect(routeId).toHaveLength(22)
      expect(fromRouteNewsPostId(routeId)).toBe(UUID)
    })

    test('produces a URL-safe id', () => {
      const routeId = toRouteNewsPostId(UUID)
      expect(routeId).toMatch(/^[A-Za-z0-9_-]{22}$/)
    })
  })

  describe('urlForNewsPost', () => {
    test('uses the "_" placeholder slug when no title is provided', () => {
      const routeId = toRouteNewsPostId(UUID)
      expect(urlForNewsPost(UUID)).toBe(`/news/${routeId}/_`)
    })

    test('includes a slugified title when provided', () => {
      const routeId = toRouteNewsPostId(UUID)
      expect(urlForNewsPost(UUID, 'Update 10.4.0')).toBe(`/news/${routeId}/update-1040`)
    })

    test('is consistent with fromRouteNewsPostId for the id segment', () => {
      const url = urlForNewsPost(UUID, 'Some Title')
      const [, , routeIdSegment] = url.split('/')
      expect(fromRouteNewsPostId(routeIdSegment as RouteNewsPostId)).toBe(UUID)
    })
  })
})
