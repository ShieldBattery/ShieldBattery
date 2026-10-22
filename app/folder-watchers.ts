import { FSWatcher, statSync, watch } from 'node:fs'
import path from 'node:path'
import { getErrorStack } from '../common/errors'

interface WatchEntry {
  watcher: FSWatcher
  /** The folder this entry watches: the watched folder itself, or the closest one above it. */
  watchedPath: string
  recursive: boolean
}

function isDirectory(folder: string): boolean {
  try {
    return statSync(folder).isDirectory()
  } catch {
    return false
  }
}

/** The closest folder above `folder` that exists, or `undefined` if none does (a missing drive). */
function closestExistingAncestor(folder: string): string | undefined {
  let current = folder
  for (;;) {
    const parent = path.win32.dirname(current)
    if (parent === current) {
      return undefined
    }
    if (isDirectory(parent)) {
      return parent
    }
    current = parent
  }
}

/**
 * Recursive watches on a set of folders that keep working while the folders are missing, deleted
 * and recreated. A folder that exists is watched recursively. One that doesn't is waited for by
 * watching the closest folder above it that does, which notices it (or a folder on the way to it)
 * being created.
 *
 * Deleting a recursively watched folder on Windows doesn't end its watch: from then on the watch
 * reports the folder itself, by its absolute path, as renamed, tens of thousands of times a second,
 * until it's closed. Such an event closes the watch and goes back to waiting for the folder.
 */
export class FolderWatchers {
  private folders: ReadonlyArray<string> = []
  private readonly entries = new Map<string, WatchEntry>()

  /**
   * `onChange` is called for every change inside a watched folder, and when a folder starts being
   * watched after it was missing.
   */
  constructor(
    private readonly onChange: () => void,
    private readonly logger: { warning(message: string): void },
  ) {}

  /** Replaces the watched folders. */
  setFolders(folders: ReadonlyArray<string>): void {
    this.close()
    this.folders = folders
    this.refresh({ notify: false })
  }

  close(): void {
    for (const entry of this.entries.values()) {
      entry.watcher.close()
    }
    this.entries.clear()
  }

  /**
   * Brings each folder's watch in line with whether it exists now. `notify` calls `onChange` if a
   * folder starts being watched recursively, so its contents get looked at.
   */
  refresh({ notify }: { notify: boolean }): void {
    let started = false
    for (const folder of this.folders) {
      // Repeats when the folder, or a folder closer to it, appears while a watch is being set up,
      // since the watch would miss that
      for (;;) {
        const entry = this.entries.get(folder)
        if (isDirectory(folder)) {
          if (!entry?.recursive) {
            this.closeEntry(folder)
            started = this.watchFolder(folder) || started
          }
          break
        }
        const ancestor = closestExistingAncestor(folder)
        if (entry && !entry.recursive && entry.watchedPath === ancestor) {
          break
        }
        this.closeEntry(folder)
        if (!ancestor || !this.watchAncestor(folder, ancestor)) {
          break
        }
      }
    }
    if (started && notify) {
      this.onChange()
    }
  }

  private watchFolder(folder: string): boolean {
    let watcher: FSWatcher
    try {
      watcher = watch(folder, { recursive: true }, (_event, fileName) => {
        if (this.entries.get(folder)?.watcher !== watcher) {
          return
        }
        if (fileName && path.win32.isAbsolute(fileName)) {
          // The folder itself was deleted or replaced, so this watch is dead
          this.closeEntry(folder)
          this.refresh({ notify: false })
        }
        this.onChange()
      })
    } catch (err) {
      this.logger.warning(`Could not watch folder '${folder}': ${getErrorStack(err)}`)
      return false
    }
    this.track(folder, { watcher, watchedPath: folder, recursive: true })
    return true
  }

  private watchAncestor(folder: string, ancestor: string): boolean {
    let watcher: FSWatcher
    try {
      watcher = watch(ancestor, () => {
        if (this.entries.get(folder)?.watcher === watcher) {
          this.refresh({ notify: true })
        }
      })
    } catch (err) {
      this.logger.warning(`Could not watch folder '${ancestor}': ${getErrorStack(err)}`)
      return false
    }
    this.track(folder, { watcher, watchedPath: ancestor, recursive: false })
    return true
  }

  private track(folder: string, entry: WatchEntry): void {
    entry.watcher.on('error', err => {
      // Left closed rather than retried at once, so a watch that keeps failing can't spin; the
      // owner's next `refresh` watches the folder again.
      this.logger.warning(`Error watching folder '${entry.watchedPath}': ${getErrorStack(err)}`)
      if (this.entries.get(folder) === entry) {
        this.closeEntry(folder)
      }
    })
    this.entries.set(folder, entry)
  }

  private closeEntry(folder: string): void {
    this.entries.get(folder)?.watcher.close()
    this.entries.delete(folder)
  }
}
