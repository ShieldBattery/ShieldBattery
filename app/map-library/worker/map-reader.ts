import { open } from 'node:fs/promises'
import { isMainThread, parentPort } from 'node:worker_threads'
import { getErrorStack } from '../../../common/errors'
import { hashMapBytes, readMapSummary, toLocalMapInfo } from '../map-summary'
import { ReaderRequest, ReaderResponse } from './messages'

// Reads map files for the map index worker: hashes them, and reads their facts with broodmap. This
// runs in its own short-lived worker because broodmap's WebAssembly memory only ever grows: reading
// one huge map (some EUD maps are over 60 MB) would otherwise keep that peak allocated for as long
// as the app runs. The index worker starts readers for a reconcile and ends them afterwards.

if (isMainThread) {
  throw new Error('map-reader should not be run in the main thread')
}

/** Reused for every file, so a reader holds at most one file in memory. */
let buffer = Buffer.alloc(0)
/** The bytes of the file last hashed, which `summarize` reads. */
let lastBytes: Uint8Array | undefined

async function readFile(filePath: string, size: number): Promise<Uint8Array> {
  if (buffer.length < size) {
    buffer = Buffer.allocUnsafe(size)
  }
  const handle = await open(filePath, 'r')
  try {
    let offset = 0
    while (offset < size) {
      const { bytesRead } = await handle.read(buffer, offset, size - offset, offset)
      if (bytesRead === 0) {
        break
      }
      offset += bytesRead
    }
    return buffer.subarray(0, offset)
  } finally {
    await handle.close()
  }
}

function post(response: ReaderResponse): void {
  parentPort!.postMessage(response)
}

parentPort!.on('message', (request: ReaderRequest) => {
  switch (request.type) {
    case 'hash':
      readFile(request.path, request.size)
        .then(bytes => {
          lastBytes = bytes
          post({ id: request.id, hash: hashMapBytes(request.path, bytes) })
        })
        .catch(err => post({ id: request.id, error: getErrorStack(err) ?? String(err) }))
      break
    case 'summarize':
      try {
        post({ id: request.id, map: toLocalMapInfo(readMapSummary(lastBytes!)) })
      } catch (err) {
        post({ id: request.id, error: getErrorStack(err) ?? String(err) })
      }
      break
    default:
      request satisfies never
  }
})
