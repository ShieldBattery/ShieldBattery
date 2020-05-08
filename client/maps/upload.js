import { promises as fsPromises } from 'fs'
import path from 'path'

import fetch from '../network/fetch'

export default async function upload(filePath, apiPath) {
  const extension = path.extname(filePath).slice(1).toLowerCase()
  const file = await fsPromises.readFile(filePath)

  const formData = new FormData()
  formData.append('extension', extension)
  formData.append('file', new Blob([file]))

  const fetchParams = {
    method: 'post',
    body: formData,
  }
  return fetch(apiPath, fetchParams)
}
