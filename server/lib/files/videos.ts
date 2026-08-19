import { open } from 'fs/promises'

/** How many bytes of a candidate video file we inspect to determine its container format. */
const SNIFF_BYTES = 4096

/** The minimum number of bytes needed to identify either supported container format. */
const MIN_SNIFF_BYTES = 12

const MP4_FTYP_OFFSET = 4
const MP4_FTYP = Buffer.from('ftyp', 'ascii')

// The first 4 bytes of every EBML document (Matroska and WebM alike): this magic alone does not
// distinguish a WebM file from a plain Matroska (.mkv) file, since WebM is a constrained profile
// of the Matroska container.
const EBML_MAGIC = Buffer.from([0x1a, 0x45, 0xdf, 0xa3])
// The EBML DocType element's value for WebM specifically; its presence somewhere in the sniffed
// header is what distinguishes an actual WebM file from a generic Matroska one.
const WEBM_DOCTYPE = Buffer.from('webm', 'ascii')

/**
 * Reads only the first `SNIFF_BYTES` of the file at `filePath` (never the whole file, since
 * uploads can be up to 100MB) and determines whether it looks like an mp4 or webm video based on
 * its container magic bytes. Returns `undefined` if the file doesn't match either format.
 */
export async function sniffVideoType(filePath: string): Promise<'mp4' | 'webm' | undefined> {
  const handle = await open(filePath, 'r')
  try {
    const buf = Buffer.alloc(SNIFF_BYTES)
    const { bytesRead } = await handle.read(buf, 0, SNIFF_BYTES, 0)
    if (bytesRead < MIN_SNIFF_BYTES) {
      return undefined
    }
    const header = buf.subarray(0, bytesRead)

    // mp4: the first box is a 4-byte size followed by a 4-byte ASCII type, so the type sits at
    // offset 4 for the very first box (typically an `ftyp` box for a well-formed mp4).
    if (header.subarray(MP4_FTYP_OFFSET, MP4_FTYP_OFFSET + 4).equals(MP4_FTYP)) {
      return 'mp4'
    }

    if (header.subarray(0, EBML_MAGIC.length).equals(EBML_MAGIC) && header.includes(WEBM_DOCTYPE)) {
      return 'webm'
    }

    return undefined
  } finally {
    await handle.close()
  }
}
