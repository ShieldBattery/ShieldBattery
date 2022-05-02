export function escapeSearchString(searchStr: string) {
  return searchStr.replace(/[_%\\]/g, '\\$&')
}
