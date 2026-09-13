import { BrowserContext, expect, Page, test } from '@playwright/test'
import { SbUserId } from '../../common/users/sb-user-id'
import { ClientSessionInfo } from '../../common/users/session'
import {
  AdminBanUserRequest,
  AdminGetBansResponse,
  AdminUnbanUserRequest,
  AdminUnbanUserResponse,
} from '../../common/users/user-network'
import { adminRequestContext } from '../admin-utils'
import { clearLocalState } from '../clear-local-state'
import {
  emulateElectronClientForRoute,
  useConsistentIdentifiersForPage,
} from '../emulate-electron-client'
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
  await page.waitForSelector('[data-testid=notifications-button]')

  if (!userId) {
    throw new Error('Expected to have a userId at this point')
  }

  const banReason = 'I need to ban you to test something!'

  const adminContext = await adminRequestContext()
  const endTime = new Date()
  endTime.setHours(endTime.getHours() + 9001)
  const response = await adminContext.post(`/api/1/admin/users/${userId}/bans`, {
    data: {
      endTime: Number(endTime),
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

  const bannedText = await page.locator('[data-testid=user-banned-text]').innerText()
  expect(bannedText).toContain(banReason)
})

/**
 * Signs up a new account whose identifiers stay consistent for every later request on this page,
 * so logging back in afterwards exercises the ban evasion check against the same identifiers the
 * ban was applied to. Leaves the page logged out.
 */
async function signupConsistentUser(
  page: Page,
  context: BrowserContext,
): Promise<{ userId: SbUserId; username: string }> {
  // Not a React hook, despite the name: it pins the identifiers this page sends to the server
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useConsistentIdentifiersForPage(page)
  await goToSignup(page)

  const username = generateUsername()
  const email = `${username}@example.org`

  let userId: SbUserId | undefined
  await page.route(
    `/api/1/users`,
    async route => {
      const [response, headers] = await emulateElectronClientForRoute(route, page.url(), page)
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
  await page.waitForSelector('[data-testid=notifications-button]')

  if (!userId) {
    throw new Error('Expected to have a userId at this point')
  }

  await clearLocalState({ context, page })

  return { userId, username }
}

async function banUser(userId: SbUserId, baseURL: string, reason: string): Promise<void> {
  const adminContext = await adminRequestContext()
  const endTime = new Date()
  endTime.setHours(endTime.getHours() + 9001)
  const response = await adminContext.post(`/api/1/admin/users/${userId}/bans`, {
    data: {
      endTime: Number(endTime),
      reason,
    } satisfies AdminBanUserRequest,
    headers: {
      Origin: baseURL,
    },
  })

  if (response.status() !== 200) {
    throw new Error('Banning failed: ' + (await response.text()))
  }
}

async function unbanUser(
  userId: SbUserId,
  baseURL: string,
  reason: string,
): Promise<AdminUnbanUserResponse> {
  const adminContext = await adminRequestContext()
  const response = await adminContext.post(`/api/1/admin/users/${userId}/unban`, {
    data: { reason } satisfies AdminUnbanUserRequest,
    headers: {
      Origin: baseURL,
    },
  })

  if (response.status() !== 200) {
    throw new Error('Unbanning failed: ' + (await response.text()))
  }

  return (await response.json()) as AdminUnbanUserResponse
}

test('unbanned user can log in again without being flagged for ban evasion', async ({
  page,
  context,
  baseURL,
}) => {
  const { userId, username } = await signupConsistentUser(page, context)

  const banReason = 'Banned by mistake'
  await banUser(userId, baseURL!, banReason)

  await loginPage.navigateTo()
  await loginPage.loginWith(username, 'password123')
  const bannedText = await page.locator('[data-testid=user-banned-text]').innerText()
  expect(bannedText).toContain(banReason)

  const unbanReason = 'Appeal accepted'
  const unbanResponse = await unbanUser(userId, baseURL!, unbanReason)
  expect(unbanResponse.unbannedUsers).toEqual([userId])
  expect(unbanResponse.bans).toHaveLength(1)
  expect(unbanResponse.bans[0].reason).toBe(banReason)
  expect(unbanResponse.bans[0].unbanReason).toBe(unbanReason)
  expect(unbanResponse.bans[0].unbannedBy).toBeDefined()
  expect(unbanResponse.bans[0].endTime).toBeLessThanOrEqual(Date.now())
  // The emulated client registers 4 identifiers, all of which were banned alongside the account
  expect(unbanResponse.liftedIdentifierBans).toBe(4)

  // Logging in with the same identifiers must now succeed rather than triggering a ban evasion ban
  await loginPage.navigateTo()
  await loginPage.loginWith(username, 'password123')
  await page.waitForSelector('[data-testid=notifications-button]')

  const adminContext = await adminRequestContext()
  const historyResponse = await adminContext.get(`/api/1/admin/users/${userId}/bans`)
  const history = (await historyResponse.json()) as AdminGetBansResponse
  expect(history.bans).toHaveLength(1)
  expect(history.bans[0].unbanReason).toBe(unbanReason)
})

test('unbanning a user also unbans the accounts connected to it', async ({
  page,
  context,
  baseURL,
}) => {
  // Both accounts are created from the same page, so they share every identifier and are treated
  // as the same machine
  const first = await signupConsistentUser(page, context)
  const second = await signupConsistentUser(page, context)

  const banReason = 'Banned by mistake, with a connected account'
  await banUser(first.userId, baseURL!, banReason)

  // The connected account was banned along with the target
  await loginPage.navigateTo()
  await loginPage.loginWith(second.username, 'password123')
  const bannedText = await page.locator('[data-testid=user-banned-text]').innerText()
  expect(bannedText).toContain(banReason)

  const unbanResponse = await unbanUser(first.userId, baseURL!, 'Appeal accepted')
  expect(unbanResponse.unbannedUsers.sort()).toEqual([first.userId, second.userId].sort())
  expect(unbanResponse.bans).toHaveLength(1)
  expect(unbanResponse.bans[0].userId).toBe(first.userId)
  expect(unbanResponse.users.map(u => u.id)).toEqual(
    expect.arrayContaining([first.userId, second.userId]),
  )

  // Both accounts can log in again
  await loginPage.navigateTo()
  await loginPage.loginWith(second.username, 'password123')
  await page.waitForSelector('[data-testid=notifications-button]')
  await clearLocalState({ context, page })

  await loginPage.navigateTo()
  await loginPage.loginWith(first.username, 'password123')
  await page.waitForSelector('[data-testid=notifications-button]')
})
