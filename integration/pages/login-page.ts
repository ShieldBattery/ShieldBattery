import { Page } from '@playwright/test'
import { Locator } from 'playwright'

export class LoginPage {
  private readonly page: Page

  private readonly inputUsername: Locator
  private readonly inputPassword: Locator

  private readonly buttonLogIn: Locator

  constructor(page: Page) {
    this.page = page

    this.inputUsername = page.locator('input[name="username"]')
    this.inputPassword = page.locator('input[name="password"]')

    this.buttonLogIn = page.locator('button[data-test="submit-button"]')
  }

  async loginWith(username: string, password: string): Promise<void> {
    await this.inputUsername.fill(username)
    await this.inputPassword.fill(password)

    await this.buttonLogIn.click()
  }
}
