import { Locator, Page } from '@playwright/test'

export class EmailVerificationDialogPage {
  constructor(protected readonly page: Page) {}

  /**
   * Prevents the email verification dialog from being shown, by setting a flag the client checks
   * whenever a session initializes. This must run before the login/signup response that would
   * open the dialog -- it does not close a dialog that is already showing, so calling it after a
   * login has been submitted is a race.
   */
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
