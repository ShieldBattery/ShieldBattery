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
      .locator('[data-test="email-verification-dialog"] [data-test="cancel-button"]')
      .click()
  }

  async verifyWithCode(code: string): Promise<void> {
    await this.page.fill('[data-test="email-verification-dialog"] input[name="code"]', code)
    await this.page.click('[data-test="email-verification-dialog"] [data-test="verify-button"]')
  }

  dialogLocator(): Locator {
    return this.page.locator('[data-test="email-verification-dialog"]')
  }
}
