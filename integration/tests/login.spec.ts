import { expect, test } from '@playwright/test'

test('logging in with an existing account', async ({ page }) => {
  await page.goto('/login')
  await page.fill('input[name="username"]', 'admin')
  await page.fill('input[name="password"]', 'admin1234')
  await page.check('input[name="remember"]')
  await page.click('[data-test=submit-button]')

  const channelName = await page.innerText('[data-test=left-nav] a[href="/chat/1/ShieldBattery"]')
  expect(channelName).toBe('#ShieldBattery')
})

test('logging in with a non-existent account', async ({ page }) => {
  await page.goto('/login')
  await page.fill('input[name="username"]', 'DoesNotExist')
  await page.fill('input[name="password"]', 'password123')
  await page.click('[data-test=submit-button]')

  const errorMessage = await page.innerText('[data-test=errors-container]')
  expect(errorMessage).toBe('Incorrect username or password')
})

test('logging in with the wrong password', async ({ page }) => {
  await page.goto('/login')
  await page.fill('input[name="username"]', 'admin')
  await page.fill('input[name="password"]', 'NotMyPassword')
  await page.click('[data-test=submit-button]')

  const errorMessage = await page.innerText('[data-test=errors-container]')
  expect(errorMessage).toBe('Incorrect username or password')
})
