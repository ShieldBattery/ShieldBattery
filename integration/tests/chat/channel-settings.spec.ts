import { expect, test } from '@playwright/test'
import path from 'path'
import { ChatPage } from '../../pages/chat-page'
import { LoginPage } from '../../pages/login-page'

let loginPage: LoginPage
let chatPage: ChatPage

test.beforeEach(async ({ page }) => {
  loginPage = new LoginPage(page)
  chatPage = new ChatPage(page)
})

test('changing channel banner', async ({ page }) => {
  await loginPage.navigateTo()
  await loginPage.loginWith('admin', 'admin1234')

  await chatPage.openChannelSettings()

  let channelBannerUrl = await chatPage.getChannelBannerUrl()
  expect(channelBannerUrl).toBeNull()

  await chatPage.setChannelBanner(path.join(__dirname, 'channel-banner.png'))
  await chatPage.clickChannelSettingsSaveButton()

  await chatPage.openChannelSettings()

  channelBannerUrl = await chatPage.getChannelBannerUrl()
  expect(channelBannerUrl).toBeDefined()
})

test('changing channel badge', async ({ page }) => {
  await loginPage.navigateTo()
  await loginPage.loginWith('admin', 'admin1234')

  await chatPage.openChannelSettings()

  let channelBadgeUrl = await chatPage.getChannelBadgeUrl()
  expect(channelBadgeUrl).toBeNull()

  await chatPage.setChannelBadge(path.join(__dirname, 'channel-badge.png'))
  await chatPage.clickChannelSettingsSaveButton()

  await chatPage.openChannelSettings()

  channelBadgeUrl = await chatPage.getChannelBadgeUrl()
  expect(channelBadgeUrl).toBeDefined()
})

test('changing channel description', async ({ page }) => {
  const expectedChannelDescription = 'This is a very cool channel.'

  await loginPage.navigateTo()
  await loginPage.loginWith('admin', 'admin1234')

  await chatPage.openChannelSettings()

  await chatPage.fillChannelDescription(expectedChannelDescription)
  await chatPage.clickChannelSettingsSaveButton()

  await chatPage.openChannelSettings()

  const actualChannelTopic = await chatPage.getChannelDescription()
  expect(actualChannelTopic).toBe(expectedChannelDescription)
})

test('changing channel topic', async ({ page }) => {
  const expectedChannelTopic = "Today's topic is something cool."

  await loginPage.navigateTo()
  await loginPage.loginWith('admin', 'admin1234')

  await chatPage.openChannelSettings()

  await chatPage.fillChannelTopic(expectedChannelTopic)
  await chatPage.clickChannelSettingsSaveButton()

  await chatPage.openChannelSettings()

  const actualChannelTopic = await chatPage.getChannelTopic()
  expect(actualChannelTopic).toBe(expectedChannelTopic)
})
