import { Page } from '@playwright/test'
import { Locator } from 'playwright'

export class LoginPage {
  private readonly page: Page

  private readonly inputUsername: Locator
  private readonly inputPassword: Locator
  private readonly inputRememberMe: Locator

  private readonly buttonLogIn: Locator

  constructor(page: Page) {
    this.page = page

    this.inputUsername = page.locator('input[name="username"]')
    this.inputPassword = page.locator('input[name="password"]')
    this.inputRememberMe = page.locator('input[name="remember"]')

    this.buttonLogIn = page.locator('button[data-test="submit-button"]')
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
}
