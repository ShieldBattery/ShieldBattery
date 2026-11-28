import { readFile } from 'fs/promises'
import sharp, { Metadata, Sharp } from 'sharp'
import { BEST_OF_LOGO_MAX_DIMENSION } from '../../../common/lobbies/lobby-best-of'
import { LobbyServiceErrorCode } from '../../../common/lobbies/lobby-network'
import { LobbyServiceError } from './lobby-service'

/**
 * The box every stored logo fits in: four times the largest slot the overlay draws a logo in, so it
 * stays sharp at high overlay scales.
 */
export const BEST_OF_LOGO_BOX_WIDTH = 576
export const BEST_OF_LOGO_BOX_HEIGHT = 144

/**
 * The most pixels an SVG may be drawn at before it is fitted into the box. Drawing at a density
 * that fits the box keeps any SVG well under this; only one declaring a size so large that even the
 * lowest density sharp allows can't bring it down gets near it, and is refused.
 */
const SVG_MAX_RENDER_PIXELS = 2048 * 2048
/** The lowest and highest densities sharp accepts for drawing an SVG. */
const MIN_SVG_DENSITY = 1
const MAX_SVG_DENSITY = 100000
/** The density at which an SVG is drawn at its declared size. */
const SVG_NATURAL_DENSITY = 72
/** How long decoding and drawing a logo may take before it is given up on. */
const PROCESSING_TIMEOUT_SECONDS = 10

/**
 * Text in an SVG that is refused, because it lets librsvg decode content other than the SVG's own
 * vector shapes, or lets such content be written so the rest of this list can't see it. Anything
 * librsvg decodes that way (a raster image, or another document holding one) isn't held to sharp's
 * pixel limit, so a tiny file could make it allocate gigabytes. References to the SVG's own elements
 * (`#id`) are all a logo needs.
 */
const UNSAFE_SVG_PATTERNS: ReadonlyArray<RegExp> = [
  // Elements that load another resource: a raster image, a filter's image input, or an XInclude of
  // another document. The namespace prefix, if any, can be made of any name characters.
  /<\s*([^\s<>/:]+:)?(image|feimage|include)\b/i,
  // Entity declarations can expand to markup, so an element or attribute in their replacement text
  // never appears in the file as written.
  /<!entity/i,
  // Attribute-list declarations give elements default attribute values (an `href`, or a `url(...)`
  // paint) that never appear on the elements themselves.
  /<!attlist/i,
  // A stylesheet processing instruction links a stylesheet from outside the document's markup.
  /<\?xml-stylesheet/i,
  // Character references can spell any character in text or an attribute value, so a reference to
  // another document could be written without the characters the patterns below look for.
  /&#/,
  // CSS escapes can do the same inside a `<style>` block or a `style` attribute (`\75rl(` is
  // `url(`), and a logo has no use for them.
  /\\/,
  // A CSS import loads another stylesheet, by a plain string as well as by `url(...)`.
  /@import/i,
  // An `href` to anything but the SVG's own elements loads another document.
  /href\s*=\s*["']\s*(?!#)/i,
  // So does a `url(...)` paint, clip, mask, filter or marker to anything but the SVG's own elements.
  /url\(\s*["']?\s*(?!#)/i,
  // Inline documents are what every way of loading content within the file itself relies on, so
  // they are refused wherever they appear, under the more specific checks above.
  /data:/i,
]

function refuse(code: LobbyServiceErrorCode, message: string): never {
  throw new LobbyServiceError(code, message)
}

/** What an upload's bytes say it is, decided before any image library reads them. */
type SniffedLogo = { format: 'png' | 'webp' } | { format: 'svg'; text: string }

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/**
 * Tells a PNG, WebP or SVG apart by its bytes: a PNG by its signature, a WebP by its RIFF header,
 * and an SVG candidate as strict UTF-8 text with no NUL that contains `<svg`. Anything else, which
 * includes compressed SVGs and SVGs in any other encoding, is no logo.
 */
function sniffLogo(data: Buffer): SniffedLogo | undefined {
  if (data.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return { format: 'png' }
  }
  if (
    data.subarray(0, 4).toString('latin1') === 'RIFF' &&
    data.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return { format: 'webp' }
  }
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(data)
  } catch {
    return undefined
  }
  return !text.includes('\0') && text.includes('<svg') ? { format: 'svg', text } : undefined
}

/**
 * Checks an SVG's text for anything that is refused for safety (see `UNSAFE_SVG_PATTERNS`). The
 * text was read as UTF-8, so one declaring another encoding is refused too, since librsvg would
 * read it differently from the checks.
 */
function checkSvgSafety(text: string) {
  const encoding = /<\?xml[^>]*encoding\s*=\s*["']([^"']*)["']/i.exec(text)?.[1]
  if (
    (encoding !== undefined && !/^utf-?8$/i.test(encoding.trim())) ||
    UNSAFE_SVG_PATTERNS.some(pattern => pattern.test(text))
  ) {
    refuse(
      LobbyServiceErrorCode.BestOfLogoUnsupportedSvg,
      'SVG logos may not embed images or refer to anything outside the file',
    )
  }
}

/**
 * Reads an uploaded logo and returns it as a PNG that fits in `BEST_OF_LOGO_BOX_WIDTH` by
 * `BEST_OF_LOGO_BOX_HEIGHT`: a PNG or WebP is fitted without being enlarged, and an SVG is drawn as
 * large as fits. The format is told by the file's bytes, and sharp has to agree with it. Throws a
 * `LobbyServiceError` for a file that isn't a PNG, WebP or SVG, for a PNG or WebP larger than
 * `BEST_OF_LOGO_MAX_DIMENSION` on its longest side, and for an SVG that `checkSvgSafety` refuses.
 *
 * An SVG is checked before sharp sees it at all, since librsvg resolves entities and XIncludes as
 * soon as it parses the file, even just to read its size. The upload is only ever read from
 * memory: an SVG read from a file path may pull in other files from the same directory, which
 * holds other people's uploads.
 */
export async function rasterizeBestOfLogo(filePath: string): Promise<Buffer> {
  const data = await readFile(filePath)

  const sniffed = sniffLogo(data)
  if (!sniffed) {
    refuse(
      LobbyServiceErrorCode.BestOfLogoInvalidFormat,
      'the logo must be a PNG, WebP or SVG image',
    )
  }
  if (sniffed.format === 'svg') {
    checkSvgSafety(sniffed.text)
  }

  let metadata: Metadata
  try {
    // Only reads the header (for an SVG, parses it without drawing), so no pixel limit is needed to
    // learn the declared size
    metadata = await sharp(data, { limitInputPixels: false }).metadata()
  } catch {
    return refuse(LobbyServiceErrorCode.BestOfLogoInvalidFormat, 'the logo could not be read')
  }
  const { format, width, height } = metadata
  if (format !== sniffed.format) {
    refuse(LobbyServiceErrorCode.BestOfLogoInvalidFormat, 'the logo could not be read')
  }
  if (!width || !height) {
    refuse(LobbyServiceErrorCode.BestOfLogoInvalidFormat, 'the logo has no size')
  }

  let image: Sharp
  if (sniffed.format === 'svg') {
    const scale = Math.min(BEST_OF_LOGO_BOX_WIDTH / width, BEST_OF_LOGO_BOX_HEIGHT / height)
    const density = Math.min(
      Math.max(SVG_NATURAL_DENSITY * scale, MIN_SVG_DENSITY),
      MAX_SVG_DENSITY,
    )
    image = sharp(data, { density, limitInputPixels: SVG_MAX_RENDER_PIXELS }).resize(
      BEST_OF_LOGO_BOX_WIDTH,
      BEST_OF_LOGO_BOX_HEIGHT,
      { fit: 'inside' },
    )
  } else {
    if (Math.max(width, height) > BEST_OF_LOGO_MAX_DIMENSION) {
      refuse(LobbyServiceErrorCode.BestOfLogoTooLarge, 'the logo is too large')
    }
    image = sharp(data, {
      limitInputPixels: BEST_OF_LOGO_MAX_DIMENSION * BEST_OF_LOGO_MAX_DIMENSION,
    }).resize(BEST_OF_LOGO_BOX_WIDTH, BEST_OF_LOGO_BOX_HEIGHT, {
      fit: 'inside',
      withoutEnlargement: true,
    })
  }

  try {
    return await image.png().timeout({ seconds: PROCESSING_TIMEOUT_SECONDS }).toBuffer()
  } catch (err) {
    if (err instanceof Error && /pixel limit/i.test(err.message)) {
      refuse(LobbyServiceErrorCode.BestOfLogoTooLarge, 'the logo is too large to draw')
    }
    return refuse(LobbyServiceErrorCode.BestOfLogoInvalidFormat, 'the logo could not be read')
  }
}
