import { FullConfig, request } from '@playwright/test'
import { DEFAULT_PERMISSIONS, SbPermissions } from '../common/users/permissions'
import { AdminUpdatePermissionsRequest } from '../common/users/sb-user'
import { setAdminJwt } from './admin-utils'

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

  const { jwt } = await response.json()
  setAdminJwt(jwt)

  // Give the admin user every permission
  const permissions = Object.fromEntries(
    Object.entries(DEFAULT_PERMISSIONS).map(([key, _value]) => [key, true]),
  ) as unknown as SbPermissions
  const permissionsResponse = await requestContext.post(
    `${baseURL}/api/1/admin/users/1/permissions`,
    {
      headers: {
        Origin: baseURL!,
        Authorization: `Bearer ${jwt}`,
      },
      data: {
        permissions,
      } satisfies AdminUpdatePermissionsRequest,
    },
  )

  if (permissionsResponse.status() < 200 || permissionsResponse.status() >= 300) {
    throw new Error(
      `Got unsuccessful response for permissions request: ` +
        `${permissionsResponse.status()} ${permissionsResponse.statusText()}`,
    )
  }

  await requestContext.dispose()
}
