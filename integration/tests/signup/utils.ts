import { Page } from '@playwright/test'

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

export const VERIFICATION_LINK_REGEX = /Verify email \( (?<link>\S+) \)/
