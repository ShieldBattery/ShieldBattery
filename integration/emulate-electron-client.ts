import { APIResponse, Page, Route } from '@playwright/test'

const hookedPages = new WeakSet<Page>()

const pageIdentifiers = new WeakMap<Page, Promise<string>>()

async function getIdentifier(): Promise<string> {
  const buf = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(String(Date.now())),
  )
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Marks the page as needing consistent user identifiers throughout the test. This should be used
 * before any API calls that would need them.
 */
export function useConsistentIdentifiersForPage(page: Page) {
  if (!pageIdentifiers.has(page)) {
    pageIdentifiers.set(page, getIdentifier())
  }
}

/**
 * Cause a page to seem like an Electron client to the server. Note that this won't pull in any
 * Electron-specific code for the client, just allow it to make requests that are normally limited
 * to Electron clients.
 *
 * If `useConsistentIdentifiers` is true, the same client identifiers will be used for every hooked
 * request made by this page. (This may cause issues if you need to create more than 5 accounst in
 * a single test and don't want the account limit to trigger)
 */
export async function emulateElectronClient(page: Page): Promise<void> {
  if (hookedPages.has(page)) {
    return
  }
  hookedPages.add(page)

  await page.route(/(\/api\/)|(\/gql\/?$)/, async route => {
    const [response, headers] = await emulateElectronClientForRoute(route, page.url(), page)

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
  page?: Page,
): Promise<[response: APIResponse, headers: Record<string, string>]> {
  const reqHeaders = {
    ...route.request().headers(),
    origin: 'shieldbattery://app',
  }

  const isSignup =
    route.request().method().toUpperCase() === 'POST' &&
    route.request().url().endsWith('/api/1/users')

  const fetchOptions: Parameters<Route['fetch']>[0] = { headers: reqHeaders }
  if (
    isSignup ||
    (route.request().method().toUpperCase() === 'POST' &&
      route.request().url().endsWith('/api/1/sessions'))
  ) {
    // Add client identifiers - using the same identifier for types 1, 2, 3, 4 to trigger
    // account limits after 5 accounts (need 4+ matching identifiers for limit to apply)
    const body = JSON.parse(route.request().postData() ?? '{}')
    const identifier = await ((page ? pageIdentifiers.get(page) : undefined) ?? getIdentifier())
    body.clientIds = [
      [1, identifier],
      [2, identifier],
      [3, identifier],
      [4, identifier],
    ]
    fetchOptions.postData = JSON.stringify(body)
  }

  // The server closes idle keep-alive connections, and the pooled request context this fetch
  // goes through may reuse a socket at the same moment it's being closed, which surfaces as a
  // connection error ("socket hang up"/ECONNRESET) before any response arrives. Retrying is the
  // right response to that error and only that error: no response was received, so at worst the
  // server saw a request it never answered. Anything else propagates.
  let response: APIResponse
  let attempt = 0
  for (; ; attempt++) {
    try {
      response = await route.fetch(fetchOptions)
      break
    } catch (err) {
      if (attempt >= 2 || !/socket hang up|ECONNRESET/i.test(String(err))) {
        throw err
      }
    }
  }

  if (isSignup && attempt > 0 && response.status() === 409) {
    // Signup isn't idempotent, so retrying it above is only safe if we also handle the case
    // where the original attempt actually reached the server before the connection reset: this
    // retried request then lands on an "already exists" conflict for an account this client
    // never got a response for. Recover by logging in with the same credentials rather than
    // failing the test over a transient network blip.
    const signupBody = JSON.parse(fetchOptions.postData as string)
    response = await route.fetch({
      ...fetchOptions,
      url: route
        .request()
        .url()
        .replace(/\/api\/1\/users$/, '/api/1/sessions'),
      postData: JSON.stringify({
        username: signupBody.username,
        password: signupBody.password,
        clientIds: signupBody.clientIds,
        locale: signupBody.locale,
      }),
    })
  }

  const actualOrigin = new URL(pageUrl).origin
  const resHeaders = {
    ...response.headers(),
    'access-control-allow-origin': actualOrigin,
  }

  return [response, resHeaders]
}
