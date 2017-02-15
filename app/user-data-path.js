import { app } from 'electron'
import path from 'path'
import isDev from 'electron-is-dev'

let userDataPath = app.getPath('userData')
let initialized = isDev

export function getUserDataPath() {
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
