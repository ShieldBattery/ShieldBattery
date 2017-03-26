import fs from 'fs'
import path from 'path'
import thenify from 'thenify'

const access = thenify(fs.access)
const mkdir = thenify(fs.mkdir)

async function createDirectory(path) {
  try {
    await access(path)
  } catch (_) {
    await mkdir(path)
  }
}

async function createDirTree(dir) {
  const segments = dir.split(path.sep)
  let currentDir = ''
  for (const segment of segments) {
    currentDir += segment + path.sep
    await createDirectory(currentDir)
  }
}

export default class LocalFsStore {
  constructor({ path }) {
    this.path = path
  }

  async write(filename, stream) {
    const normalized = path.normalize(filename)
    if (path.isAbsolute(normalized) || normalized[0] === '.') {
      throw new Error('Invalid directory')
    }
    const full = path.join(this.path, normalized)
    await createDirTree(path.dirname(full))
    const out = fs.createWriteStream(full)
    stream.pipe(out)
    return new Promise((resolve, reject) => {
      out.on('finish', resolve)
      stream.on('error', reject)
      out.on('error', reject)
    })
  }
}
