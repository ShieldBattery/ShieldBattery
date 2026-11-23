import { downloadZip } from 'client-zip'
import { CollectionDownloadFile } from '../../common/typeshare'

/**
 * The most bytes of map files one archive may hold. The archive is assembled in the browser's
 * memory and blob storage before it's saved, so an unbounded collection could exhaust them.
 */
export const MAX_ARCHIVE_BYTES = 2 * 1024 * 1024 * 1024

/** How many files are in flight at once, counting the one next to be written into the archive. */
const FETCH_LOOKAHEAD = 4

/** Thrown when the files of an archive add up to more than its size limit. */
export class CollectionTooLargeError extends Error {
  constructor() {
    super('The files are too large to put in one archive')
    this.name = 'CollectionTooLargeError'
  }
}

export interface BuildCollectionArchiveOptions {
  /** Called after each file is added to the archive, with how many are added out of the total. */
  onProgress?: (done: number, total: number) => void
  /** The size limit of the archive's files in bytes. Defaults to `MAX_ARCHIVE_BYTES`. */
  maxBytes?: number
}

/**
 * Fetches `files` and writes them, in order and under their given names, into one uncompressed
 * .zip. Rejects without producing an archive if any file can't be fetched, or if the files add up to
 * more than the size limit (with a `CollectionTooLargeError`).
 */
export async function buildCollectionArchive(
  files: ReadonlyArray<CollectionDownloadFile>,
  { onProgress, maxBytes = MAX_ARCHIVE_BYTES }: BuildCollectionArchiveOptions,
): Promise<Blob> {
  const lastModified = new Date()
  // Aborts the fetches still in flight once the build has failed or finished
  const controller = new AbortController()

  // The first failure is the cause; the other fetches it aborts reject with abort errors that
  // would otherwise be what's reported.
  let failure: { error: unknown } | undefined
  let totalBytes = 0

  const fetchFile = async (file: CollectionDownloadFile): Promise<Blob> => {
    try {
      // The files are on another origin, with signed URLs that need no session or app headers, so
      // the app's own fetch wrapper doesn't apply
      // eslint-disable-next-line no-restricted-globals
      const response = await fetch(file.url, {
        signal: controller.signal,
        credentials: 'omit',
      })
      if (!response.ok) {
        throw new Error(`Fetching ${file.name} failed with status ${response.status}`)
      }
      const blob = await response.blob()
      totalBytes += blob.size
      if (totalBytes > maxBytes) {
        throw new CollectionTooLargeError()
      }
      return blob
    } catch (error) {
      failure ??= { error }
      controller.abort()
      throw error
    }
  }

  async function* entries() {
    const pending: Array<Promise<Blob>> = []
    let nextToFetch = 0
    const fillWindow = () => {
      while (nextToFetch < files.length && pending.length < FETCH_LOOKAHEAD) {
        const request = fetchFile(files[nextToFetch])
        // A fetch that fails while an earlier file is still being written would otherwise be an
        // unhandled rejection; its error reaches the build when its turn comes.
        request.catch(() => {})
        pending.push(request)
        nextToFetch++
      }
    }

    try {
      for (let i = 0; i < files.length; i++) {
        fillWindow()
        // The blob isn't kept in a variable, so nothing holds it once the archive has consumed it
        yield { name: files[i].name, input: await pending.shift()!, lastModified }
        onProgress?.(i + 1, files.length)
      }
    } finally {
      controller.abort()
    }
  }

  try {
    const response = downloadZip(entries())
    return await response.blob()
  } catch (error) {
    throw failure ? failure.error : error
  }
}
