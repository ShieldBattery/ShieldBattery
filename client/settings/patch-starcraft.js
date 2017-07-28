import fs from 'fs'
import path from 'path'
import glob from 'glob'
import childProcess from 'child_process'
import mkdirp from 'mkdirp'
import thenify from 'thenify'
import { EXE_HASHES_1161, STORM_HASHES_1161 } from '../settings/check-starcraft-path'
import { streamEndPromise, streamFinishPromise } from '../../app/common/async/stream-promise'
import getFileHash from '../../app/common/get-file-hash'
import checkFileExists from '../../app/common/check-file-exists'
import { fetchJson, fetchReadableStream } from '../network/fetch'
import { remote } from 'electron'

const asyncMkdirp = thenify(mkdirp)
const globAsync = thenify(glob)

const bspatchPath = path.resolve(remote.app.getAppPath(), '../game/dist/bspatch.exe')

function runBspatch(origFile, destFile, patchFile) {
  return new Promise((resolve, reject) => {
    let spawned
    try {
      spawned = childProcess.spawn(bspatchPath, [origFile, destFile, patchFile])
    } catch (err) {
      reject(err)
    }

    let err
    spawned
      .on('error', e => {
        err = err || e
      })
      .on('close', (code, signal) => {
        if (err === undefined && code !== 0) {
          err = new Error('Non-zero exit code: ' + (signal || code))
        }
        if (err) {
          reject(err)
        } else {
          resolve()
        }
      })
  })
}

async function checkFileHash(path, validHashes) {
  try {
    const hash = await getFileHash(path)
    return [validHashes.includes(hash), hash]
  } catch (err) {
    return [false, null]
  }
}

async function copyFile(inFile, outFile) {
  const inStream = fs.createReadStream(inFile)
  const outStream = fs.createWriteStream(outFile)
  inStream.pipe(outStream)
  await Promise.all([streamEndPromise(inStream), streamFinishPromise(outStream)])
}

async function patchFile(dirPath, outPath, filename, validHashes) {
  const inFile = path.join(dirPath, filename)
  const outFile = path.join(outPath, filename)

  const [outValid] = await checkFileHash(outFile, validHashes)
  if (outValid) {
    return
  }

  const [inValid, inHash] = await checkFileHash(inFile, validHashes)
  if (inValid) {
    // the one in the folder is already valid, we can just copy it over
    await copyFile(inFile, outFile)
    return
  }

  if (!inHash) {
    throw new Error("File doesn't exist: " + inFile)
  }

  // Check if there's a patch available for this version
  const { url } = await fetchJson(
    `/api/1/patches/${encodeURIComponent(filename)}/${encodeURIComponent(inHash)}`,
  )
  const tempPatchFile = path.join(outPath, `${filename}-${Date.now()}.patch`)
  const patchFileStream = fs.createWriteStream(tempPatchFile)
  const downloadStream = fetchReadableStream(url)
  downloadStream.pipe(patchFileStream)

  try {
    await Promise.all([streamEndPromise(downloadStream), streamFinishPromise(patchFileStream)])
    await runBspatch(inFile, outFile, tempPatchFile)
  } finally {
    fs.unlink(tempPatchFile, () => {})
  }
}

async function copyLocalDll(dirPath, downgradePath) {
  let inFile = path.join(dirPath, 'local.dll')
  const localDllExists = await checkFileExists(inFile)
  if (!localDllExists) {
    const matches = await globAsync(`${dirPath}/locales/*/local.dll`)
    if (matches.length < 1) {
      throw new Error("local.dll doesn't exist in StarCraft directory")
    } else {
      inFile = matches[0]
    }
  }
  const outFile = path.join(downgradePath, 'local.dll')

  await copyFile(inFile, outFile)
}

export async function patchStarcraftDir(dirPath, outPath) {
  await asyncMkdirp(outPath)

  await Promise.all([
    patchFile(dirPath, outPath, 'starcraft.exe', EXE_HASHES_1161),
    patchFile(dirPath, outPath, 'storm.dll', STORM_HASHES_1161),
    copyLocalDll(dirPath, outPath),
  ])
}
