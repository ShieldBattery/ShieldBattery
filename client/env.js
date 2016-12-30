export function isWeb() {
  return process.env.SB_ENV === 'web'
}

export function isElectron() {
  return !isWeb()
}

export function isProd() {
  return process.env.NODE_ENV === 'production'
}

export function isDev() {
  return !isProd()
}
