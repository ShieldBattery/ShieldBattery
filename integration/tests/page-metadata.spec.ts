import { expect, test } from '@playwright/test'
import { extractMetaContent } from '../meta-tag-utils'

test('a static page serves its own Open Graph tags', async ({ request }) => {
  const response = await request.get('/download')
  const html = await response.text()

  expect(extractMetaContent(html, 'property', 'og:title')).toBe('Download ShieldBattery')
  expect(extractMetaContent(html, 'property', 'og:url')).toMatch(/\/download$/)
})
