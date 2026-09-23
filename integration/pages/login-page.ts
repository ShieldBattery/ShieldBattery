import { Locator, Page } from '@playwright/test'

export class LoginPage {
  private readonly page: Page

  readonly inputUsername: Locator
  readonly inputPassword: Locator
  readonly inputRememberMe: Locator

  readonly buttonLogIn: Locator
  readonly buttonTogglePasswordVisibility: Locator

  readonly linkRecoverUsername: Locator
  readonly linkResetPassword: Locator
  readonly linkCreateAccount: Locator

  private readonly errorMessage: Locator

  constructor(page: Page) {
    this.page = page

    this.inputUsername = page.locator('input[name="username"]')
    this.inputPassword = page.locator('input[name="password"]')
    this.inputRememberMe = page.locator('input[name="rememberMe"]')

    this.buttonLogIn = page.locator('button[data-testid="submit-button"]')
    this.buttonTogglePasswordVisibility = page.locator('button[title="Show password"]')

    this.linkRecoverUsername = page.locator('a[href="/recover-username"]')
    this.linkResetPassword = page.locator('a[href="/forgot-password"]')
    this.linkCreateAccount = page.locator('a[href^="/signup"]')

    this.errorMessage = page.locator('div[data-testid="errors-container"]')
  }

  async loginWith(username: string, password: string): Promise<void> {
    await this.fillLoginForm(username, password)

    await this.clickLogInButton()
  }

  async fillLoginForm(username: string, password: string): Promise<void> {
    await this.inputUsername.fill(username)
    await this.inputPassword.fill(password)
  }

  async checkRememberMe(): Promise<void> {
    await this.inputRememberMe.check()
  }

  async clickLogInButton(): Promise<void> {
    await this.buttonLogIn.click()
  }

  async navigateTo(): Promise<void> {
    await this.page.goto('/login')
  }

  async getErrorMessage(): Promise<string> {
    return this.errorMessage.innerText()
  }
}
