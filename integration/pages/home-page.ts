import { Locator, Page } from '@playwright/test'
import { SocialSidebar } from './social-sidebar'

export class HomePage extends SocialSidebar {
  constructor(page: Page) {
    super(page)
  }

  latestNewsTitleLocator(): Locator {
    return this.page.locator('[data-testid=latest-news-title]')
  }

  newsFeedPrimaryLocator(): Locator {
    return this.page.locator('[data-testid=news-feed-primary]')
  }

  newsPostTitleLocator(): Locator {
    return this.page.locator('[data-testid=news-post-title]')
  }

  async goToJoinedChatChannel(channelName: string): Promise<void> {
    const channelLink = this.channelLinkLocator(channelName)
    await channelLink.click()
  }
}
