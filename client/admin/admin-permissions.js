import { useMemo } from 'react'
import { useAppSelector } from '../redux-hooks'

export function isAdmin(authState) {
  return isAdminFromPermissions(authState.permissions)
}

function isAdminFromPermissions(permissions) {
  return permissions.toSeq().some(perm => perm)
}

export function hasAllPermissions(authState, ...permissionsToCheck) {
  const perms = authState.permissions
  return permissionsToCheck.every(p => perms[p])
}

export function hasAnyPermission(authState, ...permissionsToCheck) {
  const perms = authState.permissions
  return permissionsToCheck.some(p => perms[p])
}

/**
 * A React hook that returns whether or not the current user has any admin powers.
 */
export function useIsAdmin() {
  const permissions = useAppSelector(s => s.auth.permissions)
  const isAdmin = useMemo(() => isAdminFromPermissions(permissions), [permissions])

  return isAdmin
}
