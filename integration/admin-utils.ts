import { request } from '@playwright/test'

export function setAdminJwt(jwt: string) {
  process.env.ADMIN_JWT = jwt
}

export function adminRequestContext() {
  if (!process.env.ADMIN_JWT) {
    throw new Error('Admin JWT not initialized!')
  }

  return request.newContext({
    extraHTTPHeaders: {
      Authorization: `Bearer ${process.env.ADMIN_JWT}`,
    },
  })
}
