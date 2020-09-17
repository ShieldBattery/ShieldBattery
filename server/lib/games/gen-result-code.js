const BLOCK_SIZE = 4
const PAD_CHARS = '0000'
const BASE = 36
const MAX = Math.pow(BASE, BLOCK_SIZE)

function rand() {
  return ((Math.random() * MAX) << 0).toString(BASE)
}

function padToBlockSize(str) {
  return (PAD_CHARS + str).slice(-BLOCK_SIZE)
}

/**
 * Generates a code that can be used to verify the submission of game results by a particular user.
 */
export function genResultCode() {
  return padToBlockSize(rand()) + padToBlockSize(rand())
}
