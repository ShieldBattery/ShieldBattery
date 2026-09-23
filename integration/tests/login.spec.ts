import { expect, test } from '@playwright/test'
import { ChatPage } from '../pages/chat-page'
import { EmailVerificationDialogPage } from '../pages/email-verification-dialog-page'
import { LoginPage } from '../pages/login-page'

const ERROR_INCORRECT_CREDENTIALS = 'Incorrect username or password'

let loginPage: LoginPage
let chatPage: ChatPage
let verificationDialogPage: EmailVerificationDialogPage

test.beforeEach(async ({ page }) => {
  loginPage = new LoginPage(page)
  chatPage = new ChatPage(page)
  verificationDialogPage = new EmailVerificationDialogPage(page)
})

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

test('logging in with an existing account', async () => {
  const expectedChannelName = '#ShieldBattery'

  await loginPage.navigateTo()
  await loginPage.fillLoginForm('admin', 'admin1234')
  await loginPage.checkRememberMe()
  await loginPage.clickLogInButton()

  await verificationDialogPage.closeDialog()

  const actualChannelName = await chatPage.getNameOfShieldBatteryChannel()
  expect(actualChannelName).toBe(expectedChannelName)
})

test('logging in with a non-existent account', async () => {
  await loginPage.navigateTo()
  await loginPage.loginWith('DoesNotExist', 'password123')

  const actualErrorMessage = await loginPage.getErrorMessage()
  expect(actualErrorMessage).toBe(ERROR_INCORRECT_CREDENTIALS)
})

test('logging in with the wrong password', async () => {
  await loginPage.navigateTo()
  await loginPage.loginWith('admin', 'NotMyPassword')

  const actualErrorMessage = await loginPage.getErrorMessage()
  expect(actualErrorMessage).toBe(ERROR_INCORRECT_CREDENTIALS)
})

test('tabbing through the login form visits the controls before the links', async ({ page }) => {
  await loginPage.navigateTo()

  const expectedOrder = [
    loginPage.inputUsername,
    loginPage.inputPassword,
    loginPage.buttonTogglePasswordVisibility,
    loginPage.inputRememberMe,
    loginPage.buttonLogIn,
    loginPage.linkRecoverUsername,
    loginPage.linkResetPassword,
    loginPage.linkCreateAccount,
  ]

  await expect(expectedOrder[0]).toBeFocused()
  for (const locator of expectedOrder.slice(1)) {
    await page.keyboard.press('Tab')
    await expect(locator).toBeFocused()
  }
  for (const locator of expectedOrder.slice(0, -1).reverse()) {
    await page.keyboard.press('Shift+Tab')
    await expect(locator).toBeFocused()
  }
})

test('pressing Enter in the password field submits the form', async ({ page }) => {
  await loginPage.navigateTo()
  await expect(loginPage.inputUsername).toBeFocused()

  await page.keyboard.type('DoesNotExist')
  await page.keyboard.press('Tab')
  await page.keyboard.type('password123')
  await page.keyboard.press('Enter')

  const actualErrorMessage = await loginPage.getErrorMessage()
  expect(actualErrorMessage).toBe(ERROR_INCORRECT_CREDENTIALS)
})
