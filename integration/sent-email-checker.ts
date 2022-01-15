import { APIRequestContext, test } from '@playwright/test'
import { SentEmail } from '../server/testing/sent-email'

/**
 * Retrieves all emails that have been sent to particular addresses on a fake Mailgun server.
 * Intended for use in test files (at the top level, *not* in a test method).
 */
export class SentEmailChecker {
  apiContext: APIRequestContext | undefined

  constructor() {
    test.beforeAll(async ({ playwright }) => {
      this.apiContext = await playwright.request.newContext({
        baseURL: 'http://localhost:5528',
        extraHTTPHeaders: {
          Accept: 'application/json',
        },
      })
    })

    test.afterAll(async () => {
      await this.apiContext?.dispose()
    })
  }

  async retrieveSentEmails(to: string): Promise<SentEmail[]> {
    if (!this.apiContext) {
      throw new Error('API context not set!')
    }

    const response = await this.apiContext.get(`/sent/${encodeURIComponent(to)}`)
    return response.json()
  }
}
