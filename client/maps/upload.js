import HashThrough from '../../app/common/hash-through'
import concatStream from 'concat-stream'
import fs from 'fs'
import path from 'path'
import thenify from 'thenify'

import fetch from '../network/fetch'

const asyncStat = thenify(fs.stat)

export default async function uploadMap(mapPath) {
  const extension = path.extname(mapPath).slice(1).toLowerCase()

  const hasher = new HashThrough()
  const file = fs.createReadStream(mapPath)

  hasher.hasher.update(extension)
  file.pipe(hasher)
  const fileData = await new Promise((resolve, reject) => {
    file.on('error', reject)
    hasher.pipe(concatStream(resolve))
  })
  const hash = await hasher.hashPromise
  const timestamp = (await asyncStat(mapPath)).mtime

  const formData = new FormData()
  formData.append('hash', hash)
  formData.append('extension', extension)
  formData.append('filename', path.basename(mapPath))
  formData.append('timestamp', timestamp.toJSON())
  formData.append('data', new Blob([fileData]))
  const fetchParams = {
    method: 'post',
    body: formData,
  }

  return fetch('/api/1/maps/upload', fetchParams)
}
