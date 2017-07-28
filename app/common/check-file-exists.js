import fs from 'fs'
import thenify from 'thenify'

const accessAsync = thenify(fs.access)

export default async function checkFileExists(path) {
  try {
    await accessAsync(path, fs.constants.R_OK)
    return true
  } catch (err) {
    return false
  }
}
