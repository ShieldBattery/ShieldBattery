import { Page } from '@playwright/test'
import { urlPath } from '../../../common/urls'

export async function signupWith(
  page: Page,
  { username, email, password }: { username: string; email: string; password: string },
) {
  await page.fill('input[name="username"]', username)
  await page.fill('input[name="email"]', email)
  await page.fill('input[name="password"]', password)
  await page.fill('input[name="confirmPassword"]', password)
  await page.check('input[name="ageConfirmation"]')
  // NOTE(tec27): This one needs a position because otherwise it falls on a link and opens a
  // dialog
  await page.check('input[name="policyAgreement"]', { position: { x: 4, y: 4 } })
  await page.click('[data-test=submit-button]')
}

export function getVerificationLink(templateData: Record<string, any>): string {
  return (
    templateData.HOST +
    urlPath`/verify-email?token=${templateData.token}&` +
    urlPath`userId=${templateData.userId}&username=${templateData.username}`
  )
}
