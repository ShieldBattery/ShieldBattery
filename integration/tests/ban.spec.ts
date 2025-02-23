import { expect, test } from '@playwright/test'
import { SbUserId } from '../../common/users/sb-user-id'
import { ClientSessionInfo } from '../../common/users/session'
import { AdminBanUserRequest } from '../../common/users/user-network'
import { adminRequestContext } from '../admin-utils'
import { suppressChangelog } from '../changelog-utils'
import { LoginPage } from '../pages/login-page'
import { generateUsername } from '../username-generator'
import { signupWith } from './signup/utils'

let loginPage: LoginPage

test.beforeEach(async ({ page }) => {
  loginPage = new LoginPage(page)
})

test('banned user can see message', async ({ page, baseURL }) => {
  await page.goto('/signup')
  await suppressChangelog(page)

  const username = generateUsername()
  const email = `${username}@example.org`

  let userId: SbUserId | undefined
  await page.route(
    `/api/1/users`,
    async route => {
      const response = await route.fetch()
      const body = await response.json()

      if (response.status() === 200) {
        userId = (body as ClientSessionInfo).user.id
      }

      return route.fulfill({ response })
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
