import { Page } from '@playwright/test'
import { emulateElectronClient } from '../../emulate-electron-client'

export async function goToSignup(page: Page): Promise<void> {
  await emulateElectronClient(page)
  await page.goto('/signup-i-know-im-not-in-the-app-but-i-really-want-to-anyway')
}

export async function signupWith(
  page: Page,
  {
    username,
    email,
    password,
    signupCode,
  }: {
    username: string
    email: string
    password: string
    signupCode?: string
  },
) {
  await emulateElectronClient(page)

  // If signup code is provided, show the signup code input field
  if (signupCode) {
    await page.click('[data-test=have-signup-code-link]')
    await page.fill('input[name="signupCode"]', signupCode)
  }

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
