import { expect, test } from '@playwright/test'
import path from 'path'
import { CHANNEL_BANNERS } from '../../../common/flags'
import { ChatPage } from '../../pages/chat-page'
import { LoginPage } from '../../pages/login-page'

let loginPage: LoginPage
let chatPage: ChatPage

const TEST_IMAGE_PATH = path.join(__dirname, '..', '..', 'test-image.png')
const TEST_IMAGE_PATH_INAPPROPRIATE = path.join(
  __dirname,
  '..',
  '..',
  'test-image-inappropriate.png',
)

test.beforeEach(async ({ page }) => {
  loginPage = new LoginPage(page)
  chatPage = new ChatPage(page)
})

test('changing channel banner', async ({ page }) => {
  if (!CHANNEL_BANNERS) {
    expect(true).toBe(true)
    return
  }
  await loginPage.navigateTo()
  await loginPage.loginWith('admin', 'admin1234')

  await chatPage.openChannelSettings()

  let channelBannerUrl = await chatPage.getChannelBannerUrl()
  expect(channelBannerUrl).toBeNull()

  await chatPage.setChannelBanner(TEST_IMAGE_PATH)
  await chatPage.clickChannelSettingsSaveButton()

  await chatPage.openChannelSettings()

  channelBannerUrl = await chatPage.getChannelBannerUrl()
  expect(channelBannerUrl).toContain('/files/channel-images/')
})

test('changing inappropriate channel banner', async ({ page }) => {
  if (!CHANNEL_BANNERS) {
    expect(true).toBe(true)
    return
  }
  await loginPage.navigateTo()
  await loginPage.loginWith('admin', 'admin1234')

  await chatPage.openChannelSettings()

  await chatPage.setChannelBanner(path.join(TEST_IMAGE_PATH_INAPPROPRIATE))
  await chatPage.clickChannelSettingsSaveButton()

  const errorMessage = await chatPage.getChannelSettingsSnackbarError()
  expect(errorMessage).toBe('The selected image is inappropriate. Please select a different image.')
})

test('changing channel badge', async ({ page }) => {
  if (!CHANNEL_BANNERS) {
    expect(true).toBe(true)
    return
  }
  await loginPage.navigateTo()
  await loginPage.loginWith('admin', 'admin1234')

  await chatPage.openChannelSettings()

  let channelBadgeUrl = await chatPage.getChannelBadgeUrl()
  expect(channelBadgeUrl).toBeNull()

  await chatPage.setChannelBadge(TEST_IMAGE_PATH)
  await chatPage.clickChannelSettingsSaveButton()

  await chatPage.openChannelSettings()

  channelBadgeUrl = await chatPage.getChannelBadgeUrl()
  expect(channelBadgeUrl).toContain('/files/channel-images/')
})

test('changing inappropriate channel badge', async ({ page }) => {
  if (!CHANNEL_BANNERS) {
    expect(true).toBe(true)
    return
  }
  await loginPage.navigateTo()
  await loginPage.loginWith('admin', 'admin1234')

  await chatPage.openChannelSettings()

  await chatPage.setChannelBanner(path.join(TEST_IMAGE_PATH_INAPPROPRIATE))
  await chatPage.clickChannelSettingsSaveButton()

  const errorMessage = await chatPage.getChannelSettingsSnackbarError()
  expect(errorMessage).toBe('The selected image is inappropriate. Please select a different image.')
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
