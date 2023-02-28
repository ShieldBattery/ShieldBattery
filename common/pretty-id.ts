const toBase64 = (() => {
  if (typeof Buffer !== 'undefined') {
    return (bytes: Uint8Array) => Buffer.from(bytes).toString('base64')
  }
  return (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
})()

const fromBase64 = (() => {
  if (typeof Buffer !== 'undefined') {
    return (base64: string) => Buffer.from(base64, 'base64')
  }
  return (base64: string) => Uint8Array.from(atob(base64), c => c.charCodeAt(0))
})()

/**
 * Turns a UUID string into a "pretty" form, suitable for using in client-visible things like URLs.
 */
export function encodePrettyId(uuid: string) {
  if (uuid.length !== 36) {
    throw new Error('Invalid UUID: incorrect length')
  }

  const bytes = parseUuidStr(uuid)
  const base64 = toBase64(bytes)
  return base64.replace(/\+/g, '-').replace(/\//g, '_').substring(0, 22) // drops the padding
}

/**
 * Decodes a "pretty" ID back into a UUID string.
 */
export function decodePrettyId(prettyId: string) {
  if (prettyId.length !== 22) {
    throw new Error('Invalid pretty ID: incorrect length')
  }

  const base64 = prettyId.replace(/-/g, '+').replace(/_/g, '/') + '=='
  return stringifyUuid(fromBase64(base64))
}

// Taken mostly from https://github.com/uuidjs/uuid, which we can't use because it says v6 UUIDs are
// invalid (and we also don't really need the validation it does).

function parseUuidStr(uuid: string): Uint8Array {
  let v
  const arr = new Uint8Array(16)

  arr[0] = (v = parseInt(uuid.slice(0, 8), 16)) >>> 24
  arr[1] = (v >>> 16) & 0xff
  arr[2] = (v >>> 8) & 0xff
  arr[3] = v & 0xff

  arr[4] = (v = parseInt(uuid.slice(9, 13), 16)) >>> 8
  arr[5] = v & 0xff

  arr[6] = (v = parseInt(uuid.slice(14, 18), 16)) >>> 8
  arr[7] = v & 0xff

  arr[8] = (v = parseInt(uuid.slice(19, 23), 16)) >>> 8
  arr[9] = v & 0xff

  arr[10] = ((v = parseInt(uuid.slice(24, 36), 16)) / 0x10000000000) & 0xff
  arr[11] = (v / 0x100000000) & 0xff
  arr[12] = (v >>> 24) & 0xff
  arr[13] = (v >>> 16) & 0xff
  arr[14] = (v >>> 8) & 0xff
  arr[15] = v & 0xff

  return arr
}

const byteToHex: string[] = []

for (let i = 0; i < 256; ++i) {
  byteToHex.push((i + 0x100).toString(16).slice(1))
}

export function stringifyUuid(arr: Uint8Array, offset = 0) {
  return (
    byteToHex[arr[offset + 0]] +
    byteToHex[arr[offset + 1]] +
    byteToHex[arr[offset + 2]] +
    byteToHex[arr[offset + 3]] +
    '-' +
    byteToHex[arr[offset + 4]] +
    byteToHex[arr[offset + 5]] +
    '-' +
    byteToHex[arr[offset + 6]] +
    byteToHex[arr[offset + 7]] +
    '-' +
    byteToHex[arr[offset + 8]] +
    byteToHex[arr[offset + 9]] +
    '-' +
    byteToHex[arr[offset + 10]] +
    byteToHex[arr[offset + 11]] +
    byteToHex[arr[offset + 12]] +
    byteToHex[arr[offset + 13]] +
    byteToHex[arr[offset + 14]] +
    byteToHex[arr[offset + 15]]
  )
}
