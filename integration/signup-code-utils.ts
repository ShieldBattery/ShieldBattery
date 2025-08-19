import { Page } from '@playwright/test'
import { clearLocalState } from './clear-local-state'
import { EmailVerificationDialogPage } from './pages/email-verification-dialog-page'
import { LoginPage } from './pages/login-page'
import { ADMIN_PASSWORD, ADMIN_USERNAME } from './test-constants'

export interface CreateSignupCodeOptions {
  expiresAt: Date
  maxUses?: number
  notes?: string
}

/**
 * Creates a signup code using the admin UI.
 * Returns the created signup code text.
 */
async function createSignupCodeThroughUi(
  page: Page,
  context: any,
  options: CreateSignupCodeOptions,
): Promise<string> {
  if (page.url() !== 'about:blank') {
    await clearLocalState({ context, page })
  }
  await new EmailVerificationDialogPage(page).suppressEmailVerificationDialog()

  // Log into the admin account
  const loginPage = new LoginPage(page)
  await loginPage.navigateTo()
  await loginPage.fillLoginForm(ADMIN_USERNAME, ADMIN_PASSWORD)
  await loginPage.clickLogInButton()
  await page.waitForSelector('[data-test=app-bar-user-button]')

  // Navigate to the Signup Codes admin page
  await page.goto('/admin/signup-codes')

  // Fill out the create code form
  const expiresAtString = options.expiresAt.toISOString().slice(0, 16) // Format for datetime-local input
  await page.fill('input[name="expiresAt"]', expiresAtString)

  if (options.maxUses) {
    await page.fill('input[name="maxUses"]', options.maxUses.toString())
  }

  if (options.notes) {
    await page.fill('input[name="notes"]', options.notes)
  }

  // Submit the form
  await page.click('[data-test=create-signup-code-button]')

  // Wait for the code to be created and extract it from the UI
  await page.waitForTimeout(1000) // Give time for the list to refresh

  // Find the signup code by looking for the row with our specific notes
  let signupCode: string | null = null
  if (options.notes) {
    // Find the row that contains our specific notes text
    const allRows = page.locator('[data-signup-code]')
    const rowCount = await allRows.count()

    for (let i = 0; i < rowCount; i++) {
      const row = allRows.nth(i)
      const notesCell = row.locator('div').last() // Notes is the last column
      const notesText = await notesCell.textContent()

      if (notesText?.includes(options.notes)) {
        signupCode = await row.getAttribute('data-signup-code')
        break
      }
    }
  } else {
    // Fallback to first row if no notes provided
    const codeElement = page.locator('[data-signup-code]').first()
    signupCode = await codeElement.getAttribute('data-signup-code')
  }

  if (!signupCode) {
    throw new Error('Failed to create signup code or extract code from UI')
  }

  // Log out to clean up
  await clearLocalState({ context, page })

  return signupCode
}

/**
 * Creates a signup code that expires in the future (good for testing valid codes). This will clear
 * any existing local state.
 */
export async function createValidSignupCode(
  page: Page,
  context: any,
  maxUses?: number,
): Promise<string> {
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + 7) // Expires in 7 days

  // Create unique notes to identify this specific code among potentially many
  const uniqueId = Math.random().toString(36).substring(2, 15)
  const notes = `Test code ${uniqueId}${maxUses ? ` maxUses:${maxUses}` : ''}`

  return createSignupCodeThroughUi(page, context, {
    expiresAt,
    maxUses,
    notes,
  })
}
