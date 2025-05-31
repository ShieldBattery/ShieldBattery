import { expect, test } from '@playwright/test'
import { SbUserId } from '../../common/users/sb-user-id'
import { ClientSessionInfo } from '../../common/users/session'
import { AdminBanUserRequest } from '../../common/users/user-network'
import { adminRequestContext } from '../admin-utils'
import { emulateElectronClientForRoute } from '../emulate-electron-client'
import { LoginPage } from '../pages/login-page'
import { generateUsername } from '../username-generator'
import { goToSignup, signupWith } from './signup/utils'

let loginPage: LoginPage

test.beforeEach(async ({ page }) => {
  loginPage = new LoginPage(page)
})
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

test('banned user can see message', async ({ page, baseURL }) => {
  await goToSignup(page)

  const username = generateUsername()
  const email = `${username}@example.org`

  let userId: SbUserId | undefined
  await page.route(
    `/api/1/users`,
    async route => {
      const [response, headers] = await emulateElectronClientForRoute(route, page.url())
      const body = await response.json()

      if (response.status() === 200) {
        userId = (body as ClientSessionInfo).user.id
      }

      return route.fulfill({ response, headers })
    },
    { times: 1 },
  )

  await signupWith(page, {
    username,
    password: 'password123',
    email,
  })
  await page.waitForSelector('[data-test=notifications-button]')

  if (!userId) {
    throw new Error('Expected to have a userId at this point')
  }

  const banReason = 'I need to ban you to test something!'

  const adminContext = await adminRequestContext()
  const response = await adminContext.post(`/api/1/admin/users/${userId}/bans`, {
    data: {
      banLengthHours: 9001,
      reason: banReason,
    } satisfies AdminBanUserRequest,
    headers: {
      Origin: baseURL!,
    },
  })

  if (response.status() !== 200) {
    throw new Error('Banning failed: ' + (await response.text()))
  }

  await loginPage.navigateTo()
  await loginPage.fillLoginForm(username, 'password123')
  await loginPage.clickLogInButton()

  const bannedText = await page.locator('[data-test=user-banned-text]').innerText()
  expect(bannedText).toContain(banReason)
})
