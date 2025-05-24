import { Locator, Page } from '@playwright/test'
import { SocialSidebar } from './social-sidebar'

export class HomePage extends SocialSidebar {
  constructor(page: Page) {
    super(page)
  }

  latestNewsTitleLocator(): Locator {
    return this.page.locator('[data-test=latest-news-title]')
  }

  async goToJoinedChatChannel(channelName: string): Promise<void> {
    const channelLink = this.channelLinkLocator(channelName)
    await channelLink.click()
  }
}
