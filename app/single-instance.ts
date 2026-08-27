import { app } from 'electron'
import fs from 'fs'
import net from 'net'
import os from 'os'
import path from 'path'
import sanitize from 'sanitize-filename'

export interface NewInstanceNotification {
  /** The command-line arguments for the new instance. */
  args: string[]
}

/**
 * Ensures only one instance of the app runs, focusing the existing one if a second is launched.
 *
 * `loadNotifier` is called only on the instance that wins, and is a thunk so that the loser never
 * loads the app -- it quits instead, and the app's module-scope setup must not run first.
 */
export default function (
  loadNotifier: () => Promise<(data: NewInstanceNotification) => void>,
): void {
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
      // `end` half-closes the connection once the payload has been flushed, which is the
      // receiver's signal that the message is complete -- quitting before the flush could
      // truncate it mid-write. The timer quits anyway if the first instance never drains the
      // pipe, since a wedged receiver shouldn't leave this instance running invisibly.
      const quit = () => app.quit()
      const quitTimeout = setTimeout(quit, 2000)
      client.end(JSON.stringify(notification), () => {
        clearTimeout(quitTimeout)
        quit()
      })
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
      const notifyNewInstance = loadNotifier()
      // A pipe delivers a stream, not messages: one connection carries exactly one JSON payload,
      // complete only when the sender half-closes, so chunks are buffered until `end` rather than
      // parsed as they arrive (argv can split across reads).
      const MAX_NOTIFICATION_BYTES = 64 * 1024
      net
        .createServer(connection => {
          const chunks: Buffer[] = []
          let totalBytes = 0
          connection.on('data', data => {
            totalBytes += data.length
            if (totalBytes > MAX_NOTIFICATION_BYTES) {
              // No legitimate argv payload approaches this size; drop the connection rather than
              // buffering unboundedly for whatever is on the other end.
              connection.destroy()
              chunks.length = 0
              return
            }
            chunks.push(data)
          })
          connection.on('end', () => {
            if (!chunks.length) {
              return
            }
            try {
              const notification = JSON.parse(
                Buffer.concat(chunks).toString(),
              ) as NewInstanceNotification
              notifyNewInstance.then(notify => notify(notification)).catch(() => {})
            } catch (e) {
              // Not much to do here, we must have gotten data that wasn't valid JSON?
            }
          })
          connection.on('error', () => {})
        })
        .on('error', () => app.quit())
        .listen(socket)
    })
}
