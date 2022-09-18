import { expect, test } from '@playwright/test'
import { LoginPage } from '../pages/login-page'

const ERROR_INCORRECT_CREDENTIALS = 'Incorrect username or password'

let loginPage: LoginPage

test.beforeEach(async ({ page }) => {
  loginPage = new LoginPage(page)
})

test('logging in with an existing account', async ({ page }) => {
  const expectedChannelName = '#ShieldBattery'

  await loginPage.navigateTo()
  await loginPage.fillLoginForm('admin', 'admin1234')
  await loginPage.checkRememberMe()
  await loginPage.clickLogInButton()

  const channelName = await page.innerText('[data-test=left-nav] a[href="/chat/1/ShieldBattery"]')
  expect(channelName).toBe(expectedChannelName)
})

test('logging in with a non-existent account', async () => {
  await loginPage.navigateTo()
  await loginPage.loginWith('DoesNotExist', 'password123')

  const errorMessage = await loginPage.getErrorMessage()
  expect(errorMessage).toBe(ERROR_INCORRECT_CREDENTIALS)
})

test('logging in with the wrong password', async () => {
  await loginPage.navigateTo()
  await loginPage.loginWith('admin', 'NotMyPassword')

  const errorMessage = await loginPage.getErrorMessage()
  expect(errorMessage).toBe(ERROR_INCORRECT_CREDENTIALS)
})
