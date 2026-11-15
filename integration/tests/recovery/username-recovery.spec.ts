import { BrowserContext, expect, Page, test } from '@playwright/test'
import { TranslationLanguage } from '../../../common/i18n'
import { emailSubject, emailTemplateVersion } from '../../../server/lib/mail/email-templates'
import { clearLocalState } from '../../clear-local-state'
import { SentEmailChecker } from '../../sent-email-checker'
import { generateUsername } from '../../username-generator'
import { goToSignup, signupWith } from '../signup/utils'

const sentEmailChecker = new SentEmailChecker()

/** The `SB_CANONICAL_HOST` of the integration test servers. */
const HOST = 'http://localhost:5527'

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

/**
 * Signs up an account, then requests a username recovery email for it while logged out. Returns the
 * emails sent to the account's address afterwards.
 */
async function signupAndRecoverUsername({
  context,
  page,
}: {
  context: BrowserContext
  page: Page
}) {
  await goToSignup(page)

  const username = generateUsername()
  const email = `${username}@example.org`

  await signupWith(page, {
    username,
    password: 'password123',
    email,
  })

  await page.waitForSelector('[data-testid=notifications-button]')

  // Clear local state to simulate a fresh session
  await clearLocalState({ context, page })
  await sentEmailChecker.resetEmailsFor(email)

  // Navigate to the username recovery page
  await page.goto('/recover-username')

  // Fill in the email address and submit the form
  await page.fill('input[name="email"]', email)
  await page.click('[data-testid=submit-button]')

  // Wait for the success message
  await page.waitForSelector('[data-testid=recover-username-success]')

  return { username, emails: await sentEmailChecker.retrieveSentEmails(email) }
}

test('recover username after signing up', async ({ context, page }) => {
  const { username, emails } = await signupAndRecoverUsername({ context, page })

  // Check the sent email for the recovered username
  expect(emails).toHaveLength(1)
  expect(emails[0].templateVariables.accounts).toEqual([
    { loginName: username, displayName: username },
  ])
  expect(emails[0].version).toBe(emailTemplateVersion(HOST, TranslationLanguage.English))
  expect(emails[0].subject).toBe(emailSubject('username-recovery', TranslationLanguage.English))
})

test.describe('with a Spanish browser', () => {
  test.use({ locale: 'es-ES' })

  test('recovery email is in the language stored on the account', async ({ context, page }) => {
    const { emails } = await signupAndRecoverUsername({ context, page })

    expect(emails).toHaveLength(1)
    expect(emails[0].version).toBe(emailTemplateVersion(HOST, TranslationLanguage.Spanish))
    expect(emails[0].subject).toBe(emailSubject('username-recovery', TranslationLanguage.Spanish))
  })
})
