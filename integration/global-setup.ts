import { FullConfig, request } from '@playwright/test'

export default async function globalSetup(config: FullConfig) {
  const { baseURL } = config.projects[0].use

  const requestContext = await request.newContext()
  const response = await requestContext.post(`${baseURL}/api/1/users`, {
    headers: {
      Origin: baseURL!,
    },
    data: {
      username: 'admin',
      email: 'admin@example.org',
      password: 'admin1234',
      clientIds: [[0, 'adminBrowser']],
    },
  })

  if (response.status() !== 200) {
    throw new Error(
      `Got unsuccessful response for signup request: ${response.status()} ${response.statusText()}`,
    )
  }

  await requestContext.storageState({ path: 'test-state/admin-state.json' })
  await requestContext.dispose()
}
