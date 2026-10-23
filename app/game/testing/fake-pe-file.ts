import { FileVersion } from '../pe-version'

export interface FakePeFileOptions {
  /** Defaults to a 64-bit (PE32+) image. */
  is64Bit?: boolean
  /** Omit to build an image without a resource directory. */
  fileVersion?: FileVersion
  /** Defaults to a value unlike `fileVersion`, so tests notice if the wrong one is read. */
  productVersion?: FileVersion
}

const SECTION_RVA = 0x1000
const SECTION_FILE_OFFSET = 0x200

/**
 * Builds the smallest PE image that carries a version resource where Windows would look for it:
 * headers, then a single `.rsrc` section holding a type -> name -> language resource tree.
 */
export function makeFakePeFile({
  is64Bit = true,
  fileVersion,
  productVersion = [9, 9, 9, 9],
}: FakePeFileOptions): Buffer {
  const resources = fileVersion ? makeResourceSection(fileVersion, productVersion) : undefined

  const dataDirectoriesOffset = is64Bit ? 112 : 96
  const optionalHeaderSize = dataDirectoriesOffset + 16 * 8
  const peOffset = 0x40
  const optionalHeaderOffset = peOffset + 24
  const sectionTableOffset = optionalHeaderOffset + optionalHeaderSize
  const file = Buffer.alloc(SECTION_FILE_OFFSET + (resources?.length ?? 0))

  file.write('MZ', 0, 'latin1')
  file.writeUInt32LE(peOffset, 0x3c)
  file.write('PE\0\0', peOffset, 'latin1')
  file.writeUInt16LE(is64Bit ? 0x8664 : 0x14c, peOffset + 4)
  file.writeUInt16LE(resources ? 1 : 0, peOffset + 6)
  file.writeUInt16LE(optionalHeaderSize, peOffset + 20)

  file.writeUInt16LE(is64Bit ? 0x20b : 0x10b, optionalHeaderOffset)
  file.writeUInt32LE(16, optionalHeaderOffset + dataDirectoriesOffset - 4)
  if (resources) {
    file.writeUInt32LE(SECTION_RVA, optionalHeaderOffset + dataDirectoriesOffset + 2 * 8)
    file.writeUInt32LE(resources.length, optionalHeaderOffset + dataDirectoriesOffset + 2 * 8 + 4)

    file.write('.rsrc', sectionTableOffset, 'latin1')
    file.writeUInt32LE(resources.length, sectionTableOffset + 8)
    file.writeUInt32LE(SECTION_RVA, sectionTableOffset + 12)
    file.writeUInt32LE(resources.length, sectionTableOffset + 16)
    file.writeUInt32LE(SECTION_FILE_OFFSET, sectionTableOffset + 20)
    resources.copy(file, SECTION_FILE_OFFSET)
  }

  return file
}

function makeResourceSection(fileVersion: FileVersion, productVersion: FileVersion): Buffer {
  const typeDir = 0x0
  const nameDir = 0x18
  const languageDir = 0x30
  const dataEntry = 0x48
  const versionInfo = 0x58
  const fixedFileInfo = versionInfo + 40
  const section = Buffer.alloc(fixedFileInfo + 52)

  const writeDirectory = (offset: number, id: number, data: number) => {
    section.writeUInt16LE(1, offset + 14)
    section.writeUInt32LE(id, offset + 16)
    section.writeUInt32LE(data >>> 0, offset + 20)
  }
  writeDirectory(typeDir, 16 /* RT_VERSION */, 0x80000000 | nameDir)
  writeDirectory(nameDir, 1, 0x80000000 | languageDir)
  writeDirectory(languageDir, 0x409, dataEntry)

  section.writeUInt32LE(SECTION_RVA + versionInfo, dataEntry)
  section.writeUInt32LE(section.length - versionInfo, dataEntry + 4)

  section.writeUInt16LE(section.length - versionInfo, versionInfo)
  section.writeUInt16LE(52, versionInfo + 2)
  section.write('VS_VERSION_INFO\0', versionInfo + 6, 'utf16le')

  const [major, minor, patch, build] = fileVersion
  const [productMajor, productMinor, productPatch, productBuild] = productVersion
  section.writeUInt32LE(0xfeef04bd, fixedFileInfo)
  section.writeUInt32LE(0x00010000, fixedFileInfo + 4)
  section.writeUInt32LE(((major << 16) | minor) >>> 0, fixedFileInfo + 8)
  section.writeUInt32LE(((patch << 16) | build) >>> 0, fixedFileInfo + 12)
  section.writeUInt32LE(((productMajor << 16) | productMinor) >>> 0, fixedFileInfo + 16)
  section.writeUInt32LE(((productPatch << 16) | productBuild) >>> 0, fixedFileInfo + 20)

  return section
}
