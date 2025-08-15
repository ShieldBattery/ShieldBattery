import { APIResponse, Page, Route } from '@playwright/test'

const hookedPages = new WeakSet<Page>()

/**
 * Cause a page to seem like an Electron client to the server. Note that this won't pull in any
 * Electron-specific code for the client, just allow it to make requests that are normally limited
 * to Electron clients.
 */
export async function emulateElectronClient(page: Page): Promise<void> {
  if (hookedPages.has(page)) {
    return
  }
  hookedPages.add(page)

  await page.route(/(\/api\/)|(\/gql\/?$)/, async route => {
    const [response, headers] = await emulateElectronClientForRoute(route, page.url())

    await route.fulfill({
      response,
      headers,
    })
  })
}

const FAKE_IDENTIFIER = globalThis.crypto.subtle
  .digest('SHA-256', new TextEncoder().encode(String(Date.now())))
  .then(buf => Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join(''))

/**
 * Emulate an Electron client for a specific route. This is a lower-level version of
 * `emulateElectronClient` that allows you to handle the response and headers yourself, in case you
 * need to read something out of the response.
 *
 * **Note:** If you use this, you may need to add a call to `emulateElectronClient` at the start of
 * your test, otherwise any later calls to `emaulateElectronClient` might take priority over your
 * `page.route` handler.
 */
export async function emulateElectronClientForRoute(
  route: Route,
  pageUrl: string,
): Promise<[response: APIResponse, headers: Record<string, string>]> {
  const reqHeaders = {
    ...route.request().headers(),
    origin: 'shieldbattery://app',
  }

  const fetchOptions: Parameters<Route['fetch']>[0] = { headers: reqHeaders }
  if (
    route.request().method().toUpperCase() === 'POST' &&
    (route.request().url().endsWith('/api/1/users') ||
      route.request().url().endsWith('/api/1/sessions'))
  ) {
    // Add client identifiers
    const body = JSON.parse(route.request().postData() ?? '{}')
    body.clientIds = [[1, await FAKE_IDENTIFIER]]
    fetchOptions.postData = JSON.stringify(body)
  }

  const response = await route.fetch(fetchOptions)
  const actualOrigin = new URL(pageUrl).origin
  const resHeaders = {
    ...response.headers(),
    'access-control-allow-origin': actualOrigin,
  }

  return [response, resHeaders]
}
