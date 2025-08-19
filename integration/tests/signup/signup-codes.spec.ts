import { expect, test } from '@playwright/test'
import { clearLocalState } from '../../clear-local-state'
import { useConsistentIdentifiersForPage } from '../../emulate-electron-client'
import { createValidSignupCode } from '../../signup-code-utils'
import { generateUsername } from '../../username-generator'
import { goToSignup, signupWith } from './utils'

test.describe('Signup Codes', () => {
  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' })
  })

  test('should enforce account limit without signup code', async ({ page, context }) => {
    useConsistentIdentifiersForPage(page)
    await goToSignup(page)

    // Create 5 accounts (the maximum allowed per machine)
    for (let i = 0; i < 5; i++) {
      const username = generateUsername()
      const email = `${username}@example.org`

      await signupWith(page, {
        username,
        password: 'password123',
        email,
      })

      // Should successfully land on home page
      await expect(page.locator('[data-test=latest-news-title]')).toBeVisible()

      // Log out and clear state for next signup
      await clearLocalState({ context, page })
      await goToSignup(page)
    }

    // Try to create the 6th account - should fail with account limit error
    const username = generateUsername()
    const email = `${username}@example.org`

    await signupWith(page, {
      username,
      password: 'password123',
      email,
    })

    // Should see the "too many accounts" error
    await expect(page.locator('[data-test="too-many-accounts"]')).toBeVisible()
  })

  test('should allow signup with valid code when over account limit', async ({ page, context }) => {
    // Create a valid signup code via admin UI
    const signupCode = await createValidSignupCode(page, context)

    useConsistentIdentifiersForPage(page)
    // First, create 5 accounts to reach the limit
    await goToSignup(page)

    for (let i = 0; i < 5; i++) {
      const username = generateUsername()
      const email = `${username}@example.org`

      await signupWith(page, {
        username,
        password: 'password123',
        email,
      })

      await expect(page.locator('[data-test=latest-news-title]')).toBeVisible()
      await clearLocalState({ context, page })
      await goToSignup(page)
    }

    // Try to create the 6th account with the signup code - should succeed
    const username = generateUsername()
    const email = `${username}@example.org`

    await signupWith(page, {
      username,
      password: 'password123',
      email,
      signupCode,
    })

    // Should successfully land on home page
    await expect(page.locator('[data-test=latest-news-title]')).toBeVisible()
  })

  test('should exhaust signup code after max uses', async ({ page, context }) => {
    // Create a signup code with max 2 uses via admin UI
    const signupCode = await createValidSignupCode(page, context, 2)

    useConsistentIdentifiersForPage(page)
    // First, create 5 accounts to reach the limit
    await goToSignup(page)

    for (let i = 0; i < 5; i++) {
      const username = generateUsername()
      const email = `${username}@example.org`

      await signupWith(page, {
        username,
        password: 'password123',
        email,
      })

      await expect(page.locator('[data-test=latest-news-title]')).toBeVisible()
      await clearLocalState({ context, page })
      await goToSignup(page)
    }

    // Use the signup code for the 6th account (first use)
    let username = generateUsername()
    let email = `${username}@example.org`

    await signupWith(page, {
      username,
      password: 'password123',
      email,
      signupCode,
    })

    await expect(page.locator('[data-test=latest-news-title]')).toBeVisible()
    await clearLocalState({ context, page })
    await goToSignup(page)

    // Use the signup code for the 7th account (second use, should still work)
    username = generateUsername()
    email = `${username}@example.org`

    await signupWith(page, {
      username,
      password: 'password123',
      email,
      signupCode,
    })

    await expect(page.locator('[data-test=latest-news-title]')).toBeVisible()
    await clearLocalState({ context, page })
    await goToSignup(page)

    // Try to use the signup code for the 8th account (third use, should fail)
    username = generateUsername()
    email = `${username}@example.org`

    await signupWith(page, {
      username,
      password: 'password123',
      email,
      signupCode,
    })

    // Should fail because the code is exhausted
    await expect(page.locator('[data-test="invalid-code-text"]')).toBeVisible()
  })

  test('should reject invalid signup code', async ({ page, context }) => {
    useConsistentIdentifiersForPage(page)
    // First, create 5 accounts to reach the limit
    await goToSignup(page)

    for (let i = 0; i < 5; i++) {
      const username = generateUsername()
      const email = `${username}@example.org`

      await signupWith(page, {
        username,
        password: 'password123',
        email,
      })

      await expect(page.locator('[data-test=latest-news-title]')).toBeVisible()
      await clearLocalState({ context, page })
      await goToSignup(page)
    }

    // Try to create the 6th account with an invalid signup code
    const username = generateUsername()
    const email = `${username}@example.org`

    await signupWith(page, {
      username,
      password: 'password123',
      email,
      // Hopefully we don't get unlucky and randomly gen this :)
      signupCode: 'BBBBB-BBBBB',
    })

    await expect(page.locator('[data-test="invalid-code-text"]')).toBeVisible()
  })
})
