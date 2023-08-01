import { request } from '@playwright/test'

export const ADMIN_STORAGE_STATE = 'test-state/admin-state.json'

export function adminRequestContext() {
  return request.newContext({ storageState: 'test-state/admin-state.json' })
}
