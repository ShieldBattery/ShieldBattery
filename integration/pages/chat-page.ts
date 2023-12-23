import { Locator, Page } from '@playwright/test'
import { LeftNav } from './left-nav'

export class ChatPage extends LeftNav {
  private readonly buttonHeaderActions: Locator

  private readonly buttonChannelSettings: Locator
  private readonly buttonChannelSettingsSave: Locator

  private readonly inputChannelBanner: Locator
  private readonly inputChannelBadge: Locator
  private readonly inputChannelDescription: Locator
  private readonly inputChannelTopic: Locator

  private readonly imageChannelBanner: Locator
  private readonly imageChannelBadge: Locator

  constructor(page: Page) {
    super(page)

    this.buttonHeaderActions = page.locator('button[data-test="channel-header-actions-button"]')

    this.buttonChannelSettings = page.locator('button[data-test="channel-settings-button"]')
    this.buttonChannelSettingsSave = page.locator(
      'button[data-test="channel-settings-save-button"]',
    )

    this.inputChannelBanner = page.locator('input[data-test="channel-settings-banner-input"]')
    this.inputChannelBadge = page.locator('input[data-test="channel-settings-badge-input"]')
    this.inputChannelDescription = page.locator(
      'textarea[data-test="channel-settings-description-input"]',
    )
    this.inputChannelTopic = page.locator('input[data-test="channel-settings-topic-input"]')

    this.imageChannelBanner = page.locator('img[data-test="channel-settings-banner-image"]')
    this.imageChannelBadge = page.locator('img[data-test="channel-settings-badge-image"]')
  }

  async openChannelSettings(): Promise<void> {
    await this.buttonHeaderActions.click()
    await this.buttonChannelSettings.click()
  }

  async clickChannelSettingsSaveButton(): Promise<void> {
    await this.buttonChannelSettingsSave.click()
  }

  async setChannelBanner(bannerPath: string): Promise<void> {
    // Start waiting for file chooser before clicking. Note no await.
    const fileChooserPromise = this.page.waitForEvent('filechooser')
    await this.inputChannelBanner.click()
    const fileChooser = await fileChooserPromise
    await fileChooser.setFiles(bannerPath)
  }

  async setChannelBadge(badgePath: string): Promise<void> {
    // Start waiting for file chooser before clicking. Note no await.
    const fileChooserPromise = this.page.waitForEvent('filechooser')
    await this.inputChannelBadge.click()
    const fileChooser = await fileChooserPromise
    await fileChooser.setFiles(badgePath)
  }

  async fillChannelDescription(description: string): Promise<void> {
    await this.inputChannelDescription.fill(description)
  }

  async fillChannelTopic(topic: string): Promise<void> {
    await this.inputChannelTopic.fill(topic)
  }

  async getChannelBannerUrl(): Promise<string | null> {
    if (!(await this.imageChannelBanner.isVisible())) {
      return null
    }
    return await this.imageChannelBanner.getAttribute('src')
  }

  async getChannelBadgeUrl(): Promise<string | null> {
    if (!(await this.imageChannelBadge.isVisible())) {
      return null
    }
    return await this.imageChannelBadge.getAttribute('src')
  }

  async getChannelDescription(): Promise<string> {
    return await this.inputChannelDescription.inputValue()
  }

  async getChannelTopic(): Promise<string> {
    return await this.inputChannelTopic.inputValue()
  }
}
