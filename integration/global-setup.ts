import { test as setup } from '@playwright/test'
import { setAdminJwt } from './admin-utils.js'
import { LoginPage } from './pages/login-page.js'

setup('create admin account', async ({ page, request, baseURL }) => {
  const response = await request.post(`/api/1/users`, {
    headers: {
      Origin: baseURL!,
    },
    data: {
      username: 'admin',
      email: 'admin@example.org',
      password: 'admin1234',
      clientIds: [[0, 'adminBrowser']],
    },
  })

  if (response.status() !== 200) {
    throw new Error(
      `Got unsuccessful response for signup request: ${response.status()} ${response.statusText()}`,
    )
  }

  const { jwt } = await response.json()
  setAdminJwt(jwt)

  const loginPage = new LoginPage(page)
  await loginPage.navigateTo()
  await loginPage.loginWith('admin', 'admin1234')
  await page.waitForSelector('[data-test=left-nav]')

  await page.goto('/users/1/admin/admin')
  await page.waitForSelector('[data-test=permissions-form]')

  const checkboxes = page.locator(
    'form[data-test=permissions-form] input[type=checkbox]:not(:disabled)',
  )
  const count = await checkboxes.count()
  for (let i = 0; i < count; i++) {
    await checkboxes.nth(i).check()
  }

  await page.click('[data-test=save-permissions-button]')

  await page.waitForSelector('[data-test=ban-history-section]')
})
