import { Locator, Page } from '@playwright/test'

export class EmailVerificationDialogPage {
  constructor(protected readonly page: Page) {}

  async suppressEmailVerificationDialog(): Promise<void> {
    if (this.page.url() === 'about:blank') {
      // We have to be on our own pages to set localStorage
      await this.page.goto('/')
    }
    await this.page.evaluate(() => {
      window.localStorage.setItem('__SB_TEST_DONT_SHOW_EMAIL_VERIFICATION_DIALOG', 'true')
    })
  }

  async closeDialog(): Promise<void> {
    await this.page
      .locator('[data-testid="email-verification-dialog"] [data-testid="cancel-button"]')
      .click()
  }

  async verifyWithCode(code: string): Promise<void> {
    await this.page.fill('[data-testid="email-verification-dialog"] input[name="code"]', code)
    await this.page.click('[data-testid="email-verification-dialog"] [data-testid="verify-button"]')
  }

  dialogLocator(): Locator {
    return this.page.locator('[data-testid="email-verification-dialog"]')
  }
}
