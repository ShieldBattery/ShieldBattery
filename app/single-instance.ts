import { app } from 'electron'
import * as fs from 'node:fs'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import sanitize from 'sanitize-filename'
import { getErrorStack } from '../common/errors.js'
import logger from './logger.js'

export interface NewInstanceNotification {
  /** The command-line arguments for the new instance. */
  args: string[]
}

export default function () {
  // OS X doesn't have a single instance issue
  if (process.platform === 'darwin') {
    return
  }

  const socket =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\${sanitize(os.userInfo().username ?? 'username')}-${app.name}-singleInstance`
      : path.join(os.tmpdir(), app.name + '.sock')

  const client = net
    .connect(socket, () => {
      // This will only be executed by the second instance of the app (because it will
      // successfully connect to the running server). Just send some data to the server, which is
      // running on the first instance, so the main window can be focused there and quit this
      // instance.
      const notification: NewInstanceNotification = {
        args: process.argv,
      }
      client.write(JSON.stringify(notification))
      app.quit()
    })
    .on('error', err => {
      if ((err as any).code !== 'ENOENT') throw err
      if (process.platform === 'win32') {
        try {
          fs.unlinkSync(socket)
        } catch (e) {
          if ((e as any).code !== 'ENOENT') {
            throw e
          }
        }
      }

      // This will only be executed by the first instance, because it will try to connect to a
      // socket on a server which is not running yet.
      const notifyNewInstancePromise = import('./app.js').then(m => m.notifyNewInstance)
      net
        .createServer(connection => {
          connection.on('data', data => {
            try {
              const notification = JSON.parse(data.toString()) as NewInstanceNotification
              notifyNewInstancePromise
                .then(notify => notify(notification))
                .catch(err => {
                  logger.error(`Error notifying new instance: ${getErrorStack(err)}`)
                })
            } catch (e) {
              // Not much to do here, we must have gotten data that wasn't valid JSON?
            }
          })
        })
        .on('error', () => app.quit())
        .listen(socket)
    })
}
