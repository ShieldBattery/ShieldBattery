import fs, { promises as fsPromises } from 'fs'

export default async function checkFileExists(path) {
  try {
    await fsPromises.access(path, fs.constants.R_OK)
    return true
  } catch (err) {
    return false
  }
}
