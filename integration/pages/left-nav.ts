import { Page } from '@playwright/test'
import { Locator } from 'playwright'

export abstract class LeftNav {
  protected readonly page: Page

  private readonly textShieldBatteryChannel: Locator

  protected constructor(page: Page) {
    this.page = page

    this.textShieldBatteryChannel = page.locator(
      '[data-test=left-nav] a[href="/chat/1/ShieldBattery"]',
    )
  }

  async getNameOfShieldBatteryChannel(): Promise<string> {
    return await this.textShieldBatteryChannel.innerText()
  }
}
