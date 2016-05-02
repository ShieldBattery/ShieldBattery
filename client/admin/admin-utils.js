export function isAdmin(authState) {
  return authState.permissions.valueSeq().some(perm => perm)
}

export function checkPermissions(authState, ...permissionsToCheck) {
  const perms = authState.permissions
  return permissionsToCheck.every(p => perms[p])
}
