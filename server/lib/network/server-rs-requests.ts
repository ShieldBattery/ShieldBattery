export function serverRsUrl(path: string = '/') {
  const host = process.env.SB_SERVER_RS_URL
  if (path.startsWith('/')) {
    return `${host}${path}`
  } else {
    return `${host}/${path}`
  }
}
