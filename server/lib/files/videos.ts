import { open } from 'fs/promises'

/** How many bytes of a candidate video file we inspect to determine its container format. */
const SNIFF_BYTES = 4096

/** The minimum number of bytes needed to identify either supported container format. */
const MIN_SNIFF_BYTES = 12

const MP4_FTYP_OFFSET = 4
const MP4_FTYP = Buffer.from('ftyp', 'ascii')
const MP4_MAJOR_BRAND_OFFSET = 8
const MP4_COMPATIBLE_BRANDS_OFFSET = 16

// An `ftyp` box's "brand" codes that indicate an actual mp4-family file (ISO base media / MPEG-4
// Part 14, or a variant of it, such as the fragmented/DASH profile or Apple's iTunes `M4V `).
// Brand codes not in this set belong to other ISO-BMFF-based formats that also use an `ftyp` box
// (see the comment below on why that box alone isn't sufficient to identify mp4).
const MP4_ALLOWED_BRANDS: ReadonlySet<string> = new Set([
  'isom',
  'iso2',
  'iso3',
  'iso4',
  'iso5',
  'iso6',
  'mp41',
  'mp42',
  'avc1',
  'dash',
  'M4V ',
])

// The first 4 bytes of every EBML document (Matroska and WebM alike): this magic alone does not
// distinguish a WebM file from a plain Matroska (.mkv) file, since WebM is a constrained profile
// of the Matroska container.
const EBML_MAGIC = Buffer.from([0x1a, 0x45, 0xdf, 0xa3])
// The EBML DocType element's value for WebM specifically; its presence somewhere in the sniffed
// header is what distinguishes an actual WebM file from a generic Matroska one.
const WEBM_DOCTYPE = Buffer.from('webm', 'ascii')

/**
 * Reads only the first `SNIFF_BYTES` of the file at `filePath` (never the whole file, since
 * uploads can be tens of megabytes) and determines whether it looks like an mp4 or webm video
 * based on its container magic bytes. Returns `undefined` if the file doesn't match either
 * format.
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
    // offset 4 for the very first box (typically an `ftyp` box for a well-formed mp4). An `ftyp`
    // box by itself doesn't identify mp4, though: every file in the ISO base media format family
    // starts with one, including QuickTime `.mov`, 3GP, and HEIC/AVIF images — they only differ
    // in which "brand" codes the box declares. So a match here just means "parse the box and
    // check its brands next," not "this is an mp4."
    if (header.subarray(MP4_FTYP_OFFSET, MP4_FTYP_OFFSET + 4).equals(MP4_FTYP)) {
      const boxSize = header.readUInt32BE(0)
      // A well-formed ftyp box is an 8-byte header, a 4-byte major brand, a 4-byte minor version,
      // and then zero or more 4-byte compatible brands, so its declared size must be at least 16
      // and a multiple of 4; anything else is a malformed or degenerate box we can't trust.
      if (boxSize >= 16 && boxSize % 4 === 0) {
        // The box can legitimately extend well past what we sniffed (most of an mp4's bytes live
        // in boxes that come after `ftyp`), so clamp the scan to whichever end comes first rather
        // than rejecting the file for having a box larger than the sniffed header.
        const boxEnd = Math.min(boxSize, header.length)

        const brands = new Set<string>()
        brands.add(
          header.subarray(MP4_MAJOR_BRAND_OFFSET, MP4_MAJOR_BRAND_OFFSET + 4).toString('ascii'),
        )
        for (let offset = MP4_COMPATIBLE_BRANDS_OFFSET; offset + 4 <= boxEnd; offset += 4) {
          brands.add(header.subarray(offset, offset + 4).toString('ascii'))
        }

        if (Array.from(brands).some(brand => MP4_ALLOWED_BRANDS.has(brand))) {
          return 'mp4'
        }
      }
    }

    if (header.subarray(0, EBML_MAGIC.length).equals(EBML_MAGIC) && header.includes(WEBM_DOCTYPE)) {
      return 'webm'
    }

    return undefined
  } finally {
    await handle.close()
  }
}
