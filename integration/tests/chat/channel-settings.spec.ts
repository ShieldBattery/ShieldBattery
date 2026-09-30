import { expect, test } from '@playwright/test'
import path from 'path'
import { ChatPage } from '../../pages/chat-page'
import { EmailVerificationDialogPage } from '../../pages/email-verification-dialog-page'
import { HomePage } from '../../pages/home-page'
import { LoginPage } from '../../pages/login-page'

let loginPage: LoginPage
let homePage: HomePage
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
  homePage = new HomePage(page)
  chatPage = new ChatPage(page)

  await new EmailVerificationDialogPage(page).suppressEmailVerificationDialog()
})

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

test('changing channel banner', async ({ page }) => {
  await loginPage.navigateTo()
  await loginPage.loginWith('admin', 'admin1234')
  await homePage.goToJoinedChatChannel('ShieldBattery')

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
  await loginPage.navigateTo()
  await loginPage.loginWith('admin', 'admin1234')
  await homePage.goToJoinedChatChannel('ShieldBattery')

  await chatPage.openChannelSettings()

  await chatPage.setChannelBanner(path.join(TEST_IMAGE_PATH_INAPPROPRIATE))
  await chatPage.clickChannelSettingsSaveButton()

  const errorMessage = await chatPage.getChannelSettingsErrorMessage()
  expect(errorMessage).toBe('The selected image is inappropriate. Please select a different image.')
})

test('changing channel badge', async ({ page }) => {
  await loginPage.navigateTo()
  await loginPage.loginWith('admin', 'admin1234')
  await homePage.goToJoinedChatChannel('ShieldBattery')

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
  await loginPage.navigateTo()
  await loginPage.loginWith('admin', 'admin1234')
  await homePage.goToJoinedChatChannel('ShieldBattery')

  await chatPage.openChannelSettings()

  await chatPage.setChannelBanner(path.join(TEST_IMAGE_PATH_INAPPROPRIATE))
  await chatPage.clickChannelSettingsSaveButton()

  const errorMessage = await chatPage.getChannelSettingsErrorMessage()
  expect(errorMessage).toBe('The selected image is inappropriate. Please select a different image.')
})

test('changing channel description', async ({ page }) => {
  const expectedChannelDescription = 'This is a very cool channel.'

  await loginPage.navigateTo()
  await loginPage.loginWith('admin', 'admin1234')
  await homePage.goToJoinedChatChannel('ShieldBattery')

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
  await homePage.goToJoinedChatChannel('ShieldBattery')

  await chatPage.openChannelSettings()

  await chatPage.fillChannelTopic(expectedChannelTopic)
  await chatPage.clickChannelSettingsSaveButton()

  await chatPage.openChannelSettings()

  const actualChannelTopic = await chatPage.getChannelTopic()
  expect(actualChannelTopic).toBe(expectedChannelTopic)
})

test('making a channel private', async ({ page }) => {
  // The seeded ShieldBattery channel is official, and official channels can't be made private.
  const channelName = `private-${Date.now()}`

  await loginPage.navigateTo()
  await loginPage.loginWith('admin', 'admin1234')
  // Wait for the logged-in shell before navigating, so the navigation doesn't race the login.
  await expect(homePage.channelLinkLocator('ShieldBattery')).toBeVisible()
  await chatPage.createChannel(channelName)

  await chatPage.openChannelSettings()
  expect(await chatPage.isChannelPrivateChecked()).toBe(false)

  await chatPage.setChannelPrivate(true)
  await chatPage.clickChannelSettingsSaveButton()

  await expect(chatPage.channelPrivateGlyphLocator()).toBeVisible()

  await chatPage.openChannelSettings()
  expect(await chatPage.isChannelPrivateChecked()).toBe(true)
})

test('viewing the invite links of a private channel', async ({ page }) => {
  // The seeded ShieldBattery channel is official, and official channels can't be made private.
  const channelName = `invites-${Date.now()}`

  await loginPage.navigateTo()
  await loginPage.loginWith('admin', 'admin1234')
  // Wait for the logged-in shell before navigating, so the navigation doesn't race the login.
  await expect(homePage.channelLinkLocator('ShieldBattery')).toBeVisible()
  await chatPage.createChannel(channelName)

  await chatPage.openChannelSettings()
  await chatPage.setChannelPrivate(true)
  await chatPage.clickChannelSettingsSaveButton()
  await expect(chatPage.channelPrivateGlyphLocator()).toBeVisible()

  await chatPage.openInviteLinkDialog()
  await chatPage.closeInviteLinkDialog()

  await chatPage.openChannelSettings()
  await chatPage.openInviteLinksSettingsPage()

  await expect(chatPage.inviteLinkRowsLocator()).toHaveCount(1)
  await expect(chatPage.inviteLinkRowsLocator().first()).toContainText('admin')
})

test('creating a private channel with its settings', async ({ page }) => {
  const channelName = `created-${Date.now()}`
  const description = 'Made with everything set up front.'
  const topic = 'Invite only'

  await loginPage.navigateTo()
  await loginPage.loginWith('admin', 'admin1234')
  // Wait for the logged-in shell before navigating, so the navigation doesn't race the login.
  await expect(homePage.channelLinkLocator('ShieldBattery')).toBeVisible()

  await chatPage.submitCreateChannelForm({
    name: channelName,
    description,
    topic,
    bannerPath: TEST_IMAGE_PATH,
    isPrivate: true,
  })
  await page.waitForURL(url => url.pathname.endsWith(`/${channelName}`))

  // A private channel's invite link dialog opens as soon as it's created.
  await page
    .locator('[data-testid="channel-invite-link-dialog-url"]', { hasText: '/chat/invite/' })
    .waitFor()
  await chatPage.closeInviteLinkDialog()
  await expect(chatPage.channelPrivateGlyphLocator()).toBeVisible()

  await chatPage.openChannelSettings()
  expect(await chatPage.isChannelPrivateChecked()).toBe(true)
  expect(await chatPage.getChannelDescription()).toBe(description)
  expect(await chatPage.getChannelTopic()).toBe(topic)
  expect(await chatPage.getChannelBannerUrl()).toContain('/files/channel-images/')
})

test("creating a channel with a taken name doesn't join that channel", async ({ page }) => {
  await loginPage.navigateTo()
  await loginPage.loginWith('admin', 'admin1234')
  await expect(homePage.channelLinkLocator('ShieldBattery')).toBeVisible()

  await chatPage.submitCreateChannelForm({ name: 'ShieldBattery', topic: 'Not my channel' })

  await expect(page.getByText('A channel with this name already exists.')).toBeVisible()
  expect(new URL(page.url()).pathname).toBe('/chat/new')
})

test("official channels can't be made private", async ({ page }) => {
  await loginPage.navigateTo()
  await loginPage.loginWith('admin', 'admin1234')
  await homePage.goToJoinedChatChannel('ShieldBattery')

  await chatPage.openChannelSettings()

  await expect(page.locator('input[type="checkbox"][name="private"]')).toHaveCount(0)
})
