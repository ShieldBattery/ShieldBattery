import fs from 'fs'
import path from 'path'
import thenify from 'thenify'

import fetch from '../network/fetch'

const asyncStat = thenify(fs.stat)
const asyncReadFile = thenify(fs.readFile)

export default async function upload(filePath, apiPath) {
  const extension = path
    .extname(filePath)
    .slice(1)
    .toLowerCase()
  const fileStats = await asyncStat(filePath)
  const file = await asyncReadFile(filePath)

  const formData = new FormData()
  formData.append('extension', extension)
  formData.append('filename', path.basename(filePath))
  formData.append('modifiedDate', fileStats.mtime.toJSON())
  formData.append('file', new Blob([file]))

  const fetchParams = {
    method: 'post',
    body: formData,
  }
  return fetch(apiPath, fetchParams)
}
