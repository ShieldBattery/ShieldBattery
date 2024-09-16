import { app } from 'electron'
import isDev from 'electron-is-dev'
import * as path from 'node:path'

let userDataPath = app.getPath('userData')
let initialized = isDev

export function getUserDataPath(): string {
  if (initialized) {
    return userDataPath
  }

  const exeName = path.basename(app.getPath('exe'), '.exe')
  if (exeName.toLowerCase().startsWith('shieldbattery')) {
    userDataPath = path.resolve(app.getPath('userData'), `../${exeName}`)
    app.setPath('userData', userDataPath)
  }

  initialized = true
  return userDataPath
}
