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

  const response = await route.fetch({ headers: reqHeaders })
  const actualOrigin = new URL(pageUrl).origin
  const resHeaders = {
    ...response.headers(),
    'access-control-allow-origin': actualOrigin,
  }

  return [response, resHeaders]
}
