export function isAdmin(authState) {
  return authState.permissions.toSeq().some(perm => perm)
}

export function hasAllPermissions(authState, ...permissionsToCheck) {
  const perms = authState.permissions
  return permissionsToCheck.every(p => perms[p])
}

export function hasAnyPermission(authState, ...permissionsToCheck) {
  const perms = authState.permissions
  return permissionsToCheck.some(p => perms[p])
}
