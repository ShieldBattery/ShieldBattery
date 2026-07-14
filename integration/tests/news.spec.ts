import { expect, test } from '@playwright/test'
import { EmailVerificationDialogPage } from '../pages/email-verification-dialog-page'
import { HomePage } from '../pages/home-page'
import { LoginPage } from '../pages/login-page'

// The newest seeded news post (see migrations/20260711120000_seed_news_posts.sql).
const NEWEST_POST_TITLE = 'Update 10.4.0'

let loginPage: LoginPage
let homePage: HomePage
let verificationDialogPage: EmailVerificationDialogPage

test.beforeEach(async ({ page }) => {
  loginPage = new LoginPage(page)
  homePage = new HomePage(page)
  verificationDialogPage = new EmailVerificationDialogPage(page)
})

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

test('home page news feed links to the newest post', async () => {
  await loginPage.navigateTo()
  await loginPage.fillLoginForm('admin', 'admin1234')
  await loginPage.checkRememberMe()
  await loginPage.clickLogInButton()

  await verificationDialogPage.closeDialog()

  // Logging in lands on the home page already; navigating again would reload and re-open the
  // email verification dialog over the feed.
  const primaryCard = homePage.newsFeedPrimaryLocator()
  await expect(primaryCard).toContainText(NEWEST_POST_TITLE)

  await primaryCard.click()

  await expect(homePage.newsPostTitleLocator()).toHaveText(NEWEST_POST_TITLE)
})
