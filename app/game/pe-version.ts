import { promises as fsPromises } from 'fs'

/** The four components of a Windows file version, most significant first. */
export type FileVersion = [major: number, minor: number, patch: number, build: number]

/** Reads up to `length` bytes at `offset`; returns fewer only at the end of the file. */
export type ReadAt = (offset: number, length: number) => Promise<Buffer>

const DOS_MAGIC = 0x5a4d // 'MZ'
const PE_SIGNATURE = 0x00004550 // 'PE\0\0'
const PE32_MAGIC = 0x10b
const PE32_PLUS_MAGIC = 0x20b
const RESOURCE_DATA_DIRECTORY = 2
const RT_VERSION = 16
const SUBDIRECTORY_FLAG = 0x80000000
const FIXED_FILE_INFO_SIGNATURE = 0xfeef04bd

/**
 * Reads the fixed file version (what Explorer shows as "File version") from a PE file's version
 * resource. Returns `undefined` if the file isn't a PE file or has no version resource.
 */
export async function readFileVersion(filePath: string): Promise<FileVersion | undefined> {
  const file = await fsPromises.open(filePath, 'r')
  try {
    return await parseFileVersion(async (offset, length) => {
      const buf = Buffer.alloc(length)
      const { bytesRead } = await file.read(buf, 0, length, offset)
      return buf.subarray(0, bytesRead)
    })
  } finally {
    await file.close()
  }
}

interface Section {
  virtualAddress: number
  virtualSize: number
  rawOffset: number
  rawSize: number
}

export async function parseFileVersion(readAt: ReadAt): Promise<FileVersion | undefined> {
  try {
    return await parseFileVersionUnchecked(readAt)
  } catch (err) {
    // Truncated or malformed structures make the Buffer reads go out of range
    if (err instanceof RangeError) {
      return undefined
    }
    throw err
  }
}

async function parseFileVersionUnchecked(readAt: ReadAt): Promise<FileVersion | undefined> {
  const dosHeader = await readAt(0, 0x40)
  if (dosHeader.readUInt16LE(0) !== DOS_MAGIC) {
    return undefined
  }
  const peOffset = dosHeader.readUInt32LE(0x3c)
  const fileHeader = await readAt(peOffset, 24)
  if (fileHeader.readUInt32LE(0) !== PE_SIGNATURE) {
    return undefined
  }
  const numSections = fileHeader.readUInt16LE(6)
  const optionalHeaderSize = fileHeader.readUInt16LE(20)
  const optionalHeaderOffset = peOffset + 24
  const optionalHeader = await readAt(optionalHeaderOffset, optionalHeaderSize)

  // The data directories follow the fixed fields, which are wider in PE32+ (64-bit) images
  const magic = optionalHeader.readUInt16LE(0)
  let dataDirectoriesOffset
  if (magic === PE32_MAGIC) {
    dataDirectoriesOffset = 96
  } else if (magic === PE32_PLUS_MAGIC) {
    dataDirectoriesOffset = 112
  } else {
    return undefined
  }
  const numDataDirectories = optionalHeader.readUInt32LE(dataDirectoriesOffset - 4)
  if (numDataDirectories <= RESOURCE_DATA_DIRECTORY) {
    return undefined
  }
  const resourceRva = optionalHeader.readUInt32LE(
    dataDirectoriesOffset + RESOURCE_DATA_DIRECTORY * 8,
  )
  if (resourceRva === 0) {
    return undefined
  }

  const sectionTable = await readAt(optionalHeaderOffset + optionalHeaderSize, numSections * 40)
  const sections: Section[] = []
  for (let i = 0; i < numSections; i++) {
    const entry = i * 40
    sections.push({
      virtualSize: sectionTable.readUInt32LE(entry + 8),
      virtualAddress: sectionTable.readUInt32LE(entry + 12),
      rawSize: sectionTable.readUInt32LE(entry + 16),
      rawOffset: sectionTable.readUInt32LE(entry + 20),
    })
  }
  const readRva = async (rva: number, length: number) => {
    const section = sections.find(
      s => rva >= s.virtualAddress && rva < s.virtualAddress + Math.max(s.virtualSize, s.rawSize),
    )
    if (!section) {
      throw new RangeError(`RVA 0x${rva.toString(16)} is not in any section`)
    }
    const sectionOffset = rva - section.virtualAddress
    return await readAt(
      section.rawOffset + sectionOffset,
      Math.min(length, section.rawSize - sectionOffset),
    )
  }

  // Offsets inside the resource tree are relative to its root, so read the whole tree at once.
  // The tree is type -> name -> language; any name and language will do, as executables carry a
  // single version resource.
  const resources = await readRva(resourceRva, Number.MAX_SAFE_INTEGER)
  const typeEntry = findResourceEntry(resources, 0, RT_VERSION)
  if (typeEntry === undefined || !(typeEntry & SUBDIRECTORY_FLAG)) {
    return undefined
  }
  const nameEntry = findResourceEntry(resources, typeEntry & ~SUBDIRECTORY_FLAG)
  if (nameEntry === undefined || !(nameEntry & SUBDIRECTORY_FLAG)) {
    return undefined
  }
  const languageEntry = findResourceEntry(resources, nameEntry & ~SUBDIRECTORY_FLAG)
  if (languageEntry === undefined || languageEntry & SUBDIRECTORY_FLAG) {
    return undefined
  }
  const dataRva = resources.readUInt32LE(languageEntry)
  const dataSize = resources.readUInt32LE(languageEntry + 4)
  const versionInfo = await readRva(dataRva, dataSize)

  // VS_FIXEDFILEINFO is the value of the root VS_VERSIONINFO block, DWORD-aligned after its key
  for (let i = 0; i + 16 <= versionInfo.length; i += 4) {
    if (versionInfo.readUInt32LE(i) === FIXED_FILE_INFO_SIGNATURE) {
      const high = versionInfo.readUInt32LE(i + 8)
      const low = versionInfo.readUInt32LE(i + 12)
      return [high >>> 16, high & 0xffff, low >>> 16, low & 0xffff]
    }
  }
  return undefined
}

/**
 * Returns the data field of the entry with `id` in the resource directory at `dirOffset` (or of
 * its first entry if `id` is omitted). The field's high bit marks a subdirectory.
 */
function findResourceEntry(resources: Buffer, dirOffset: number, id?: number): number | undefined {
  const numEntries = resources.readUInt16LE(dirOffset + 12) + resources.readUInt16LE(dirOffset + 14)
  for (let i = 0; i < numEntries; i++) {
    const entry = dirOffset + 16 + i * 8
    const name = resources.readUInt32LE(entry)
    if (id === undefined || (!(name & SUBDIRECTORY_FLAG) && name === id)) {
      return resources.readUInt32LE(entry + 4)
    }
  }
  return undefined
}
