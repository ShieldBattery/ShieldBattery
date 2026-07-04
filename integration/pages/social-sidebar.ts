import { Locator, Page } from '@playwright/test'

export abstract class SocialSidebar {
  protected readonly page: Page

  private readonly textShieldBatteryChannel: Locator

  protected constructor(page: Page) {
    this.page = page

    this.textShieldBatteryChannel = page.locator(
      '[data-testid=social-sidebar] a[href="/chat/1/ShieldBattery"]',
    )
  }

  async getNameOfShieldBatteryChannel(): Promise<string> {
    return await this.textShieldBatteryChannel.locator('[data-testid=entry-text]').innerText()
  }

  channelLinkLocator(channelName: string): Locator {
    return this.page.locator(`[data-testid=social-sidebar] a[href^="/chat/"]`, {
      hasText: `#${channelName}`,
    })
  }
}
