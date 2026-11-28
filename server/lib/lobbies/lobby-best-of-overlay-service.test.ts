import { writeFile as fsWriteFile, mkdtemp, rm } from 'fs/promises'
import os from 'os'
import path from 'path'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { gzipSync } from 'zlib'
import { LobbyBestOfJson } from '../../../common/lobbies/lobby-best-of'
import { LobbyServiceErrorCode } from '../../../common/lobbies/lobby-network'
import { asMockedFunction } from '../../../common/testing/mocks'
import { makeSbUserId, SbUserId } from '../../../common/users/sb-user-id'
import { deleteFile, writeFile } from '../files'
import { ImageService } from '../images/image-service'
import { ClientSocketsGroup } from '../websockets/socket-groups'
import { RememberedBestOfOverlay } from './lobby-best-of-overlay-models'
import {
  BestOfLogoChange,
  LobbyBestOfOverlayService,
  UploadedBestOfLogo,
} from './lobby-best-of-overlay-service'
import { LobbyService, LobbyServiceError } from './lobby-service'

const remembered = new Map<SbUserId, RememberedBestOfOverlay>()

vi.mock('./lobby-best-of-overlay-models', () => ({
  getRememberedBestOfOverlay: vi.fn(async (userId: SbUserId) => remembered.get(userId)),
  setRememberedBestOfOverlay: vi.fn(async (userId: SbUserId, values: RememberedBestOfOverlay) => {
    remembered.set(userId, structuredClone(values))
  }),
}))

vi.mock('../files', () => ({
  getUrl: (filePath: string) => `https://files.test/${filePath}`,
  writeFile: vi.fn(async () => {}),
  deleteFile: vi.fn(async () => {}),
}))

const HOST = makeSbUserId(1)
const OTHER = makeSbUserId(2)

/** A stand-in lobby service whose series simply echo what it was asked to start or change. */
function makeLobbyService() {
  let running: LobbyBestOfJson | undefined
  const toOverlay = (line1?: string | null, line2?: string | null, logo?: any) => {
    const overlay = {
      ...(line1?.trim() ? { line1: line1.trim() } : {}),
      ...(line2?.trim() ? { line2: line2.trim() } : {}),
      ...(logo ? { logo } : {}),
    }
    return Object.keys(overlay).length ? overlay : undefined
  }
  return {
    checkStartBestOf: vi.fn(),
    startBestOf: vi.fn((params: any): LobbyBestOfJson => {
      const overlay = toOverlay(params.line1, params.line2, params.logo)
      running = {
        id: '1',
        length: params.length,
        sides: params.sides,
        games: [],
        ...(overlay ? { overlay } : {}),
      }
      return running
    }),
    checkUpdateBestOf: vi.fn(),
    updateBestOf: vi.fn((params: any): LobbyBestOfJson => {
      const current = running!.overlay
      const overlay = toOverlay(
        params.line1 === undefined ? current?.line1 : params.line1,
        params.line2 === undefined ? current?.line2 : params.line2,
        params.logo === undefined ? current?.logo : params.logo,
      )
      const { overlay: _, ...rest } = running!
      running = overlay ? { ...rest, overlay } : rest
      return running
    }),
    replaceBestOfLogo: vi.fn(),
  }
}

function clientOf(userId: SbUserId) {
  return { userId } as unknown as ClientSocketsGroup
}

describe('lobbies/lobby-best-of-overlay-service', () => {
  let dir: string
  let lobbyService: ReturnType<typeof makeLobbyService>
  let isImageSafe: ReturnType<typeof vi.fn>
  let service: LobbyBestOfOverlayService

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'sb-best-of-logo-'))
    remembered.clear()
    asMockedFunction(writeFile).mockClear()
    asMockedFunction(deleteFile).mockClear()
    lobbyService = makeLobbyService()
    isImageSafe = vi.fn().mockResolvedValue(true)
    service = new LobbyBestOfOverlayService(
      lobbyService as unknown as LobbyService,
      { isImageSafe } as unknown as ImageService,
    )
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  /** Writes an upload to disk the way the multipart parser leaves one. */
  async function upload(data: Buffer, name = 'logo.png'): Promise<UploadedBestOfLogo> {
    const filepath = path.join(dir, `${Math.random()}`)
    await fsWriteFile(filepath, data)
    return { filepath, originalFilename: name }
  }

  function image(width: number, height: number, format: 'png' | 'webp' | 'jpeg' = 'png') {
    return sharp({
      create: { width, height, channels: 4, background: { r: 200, g: 20, b: 20, alpha: 1 } },
    })
      .toFormat(format)
      .toBuffer()
  }

  function svg(width: number, height: number, body = '') {
    return Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
        `<rect width="100%" height="100%" fill="red"/>${body}</svg>`,
    )
  }

  function start(logoChange: BestOfLogoChange = { kind: 'keep' }, lines: object = {}) {
    return service.startBestOf(
      { client: clientOf(HOST), length: 3, sides: [[HOST], [OTHER]], ...lines },
      logoChange,
    )
  }

  function update(logoChange: BestOfLogoChange = { kind: 'keep' }, changes: object = {}) {
    return service.updateBestOf({ client: clientOf(HOST), ...changes }, logoChange)
  }

  /** The PNG last written to the file store, with where it was written. */
  async function lastStored() {
    const [filePath, data, options] = asMockedFunction(writeFile).mock.calls.at(-1)!
    const metadata = await sharp(data as Buffer).metadata()
    return { filePath, options, metadata }
  }

  function codeError(code: LobbyServiceErrorCode) {
    return expect.objectContaining({ code })
  }

  test.each([
    ['PNG', () => image(400, 100, 'png'), 'brand.png', { width: 400, height: 100 }],
    ['WebP', () => image(1024, 512, 'webp'), 'brand.webp', { width: 288, height: 144 }],
    ['SVG', async () => svg(40, 10), 'brand.svg', { width: 576, height: 144 }],
    [
      'SVG using its own gradients, uses, clip paths, styles and escaped text',
      async () =>
        Buffer.from(
          '<?xml version="1.0" encoding="UTF-8"?>' +
            '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ' +
            'viewBox="0 0 80 20">' +
            '<defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/>' +
            '<stop offset="1" stop-color="#00f"/></linearGradient>' +
            '<clipPath id="c"><rect width="60" height="20"/></clipPath>' +
            '<circle id="dot" r="4"/></defs>' +
            '<style>.mark { fill: url(#g); stroke: #000 }</style>' +
            '<rect class="mark" width="80" height="20" clip-path="url(#c)"/>' +
            '<use href="#dot" x="70" y="10"/><use xlink:href="#dot" x="75" y="10"/>' +
            '<text x="2" y="14" font-size="10">Bits &amp; &lt;Bytes&gt;</text></svg>',
        ),
      'brand.svg',
      { width: 576, height: 144 },
    ],
  ])('stores an uploaded %s logo as a PNG fitted to the box', async (_, make, name, size) => {
    const file = await upload(await make(), name)

    const bestOf = await start({ kind: 'replace', file }, { line1: 'Casters  Alice' })

    const { filePath, options, metadata } = await lastStored()
    expect(filePath).toMatch(/^best-of-logos\/.+\.png$/)
    expect(options).toEqual({ acl: 'public-read', type: 'image/png' })
    expect(metadata).toEqual(expect.objectContaining({ format: 'png', ...size }))
    expect(isImageSafe).toHaveBeenCalledWith(expect.any(Buffer))
    const logo = { url: `https://files.test/${filePath}`, fileName: name }
    expect(bestOf.overlay).toEqual({ line1: 'Casters  Alice', logo })
    expect(remembered.get(HOST)).toEqual({
      line1: 'Casters  Alice',
      logo: { path: filePath, fileName: name },
    })
  })

  test.each([
    ['a JPEG', () => image(100, 100, 'jpeg'), LobbyServiceErrorCode.BestOfLogoInvalidFormat],
    [
      'a text file',
      async () => Buffer.from('not an image'),
      LobbyServiceErrorCode.BestOfLogoInvalidFormat,
    ],
    ['a PNG over 1024px', () => image(1025, 10, 'png'), LobbyServiceErrorCode.BestOfLogoTooLarge],
    ['a WebP over 1024px', () => image(10, 1100, 'webp'), LobbyServiceErrorCode.BestOfLogoTooLarge],
    [
      'an SVG embedding an image',
      async () => svg(10, 10, '<image href="data:image/png;base64,AAAA" width="1" height="1"/>'),
      LobbyServiceErrorCode.BestOfLogoUnsupportedSvg,
    ],
    [
      'an SVG referring to another document',
      async () => svg(10, 10, '<use href="other.svg#a"/>'),
      LobbyServiceErrorCode.BestOfLogoUnsupportedSvg,
    ],
    [
      'an SVG declaring entities',
      async () =>
        Buffer.concat([
          Buffer.from('<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY e "x">]>'),
          svg(10, 10),
        ]),
      LobbyServiceErrorCode.BestOfLogoUnsupportedSvg,
    ],
    [
      'an SVG declaring a size too large to draw',
      async () => svg(1000000, 1000000),
      LobbyServiceErrorCode.BestOfLogoTooLarge,
    ],
    [
      'an SVG spelling url( with a character reference',
      async () => svg(10, 10, `<rect width="1" height="1" fill="&#117;rl(other.svg#p)"/>`),
      LobbyServiceErrorCode.BestOfLogoUnsupportedSvg,
    ],
    [
      'an SVG spelling url( with a CSS escape',
      async () => svg(10, 10, `<style>rect { fill: \\75rl(other.svg#p) }</style>`),
      LobbyServiceErrorCode.BestOfLogoUnsupportedSvg,
    ],
    [
      'an SVG importing a stylesheet by a string',
      async () => svg(10, 10, `<style>@import "other.css";</style>`),
      LobbyServiceErrorCode.BestOfLogoUnsupportedSvg,
    ],
    [
      'an SVG linking a stylesheet',
      async () =>
        Buffer.concat([Buffer.from(`<?xml-stylesheet type="text/css" href="#s"?>`), svg(10, 10)]),
      LobbyServiceErrorCode.BestOfLogoUnsupportedSvg,
    ],
    [
      'an SVG declaring default attribute values',
      async () =>
        Buffer.concat([
          Buffer.from(`<?xml version="1.0"?><!DOCTYPE svg [<!ATTLIST rect fill CDATA "url(#p)">]>`),
          svg(10, 10),
        ]),
      LobbyServiceErrorCode.BestOfLogoUnsupportedSvg,
    ],
    [
      'an SVG with an image element under a non-ASCII prefix',
      async () =>
        Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" xmlns:é="http://www.w3.org/2000/svg" ' +
            'width="10" height="10"><é:image width="1" height="1" href="#x"/></svg>',
        ),
      LobbyServiceErrorCode.BestOfLogoUnsupportedSvg,
    ],
    [
      'an SVG with a data: document in a style block',
      async () => svg(10, 10, `<style>/* data:image/svg+xml;base64,AAAA */</style>`),
      LobbyServiceErrorCode.BestOfLogoUnsupportedSvg,
    ],
    [
      'an unreadable SVG with a refused element, by the safety check before anything parses it',
      async () => Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><image href="#x"'),
      LobbyServiceErrorCode.BestOfLogoUnsupportedSvg,
    ],
    [
      'a gzip-compressed SVG',
      async () => gzipSync(svg(10, 10)),
      LobbyServiceErrorCode.BestOfLogoInvalidFormat,
    ],
    [
      'an SVG in UTF-16',
      async () => Buffer.from(`﻿${svg(10, 10).toString()}`, 'utf16le'),
      LobbyServiceErrorCode.BestOfLogoInvalidFormat,
    ],
  ])('refuses %s before storing anything', async (_, make, code) => {
    remembered.set(HOST, {
      line1: 'Before',
      logo: { path: 'best-of-logos/old.png', fileName: 'o' },
    })
    const file = await upload(await make())

    await expect(start({ kind: 'replace', file }, { line1: 'After' })).rejects.toEqual(
      codeError(code),
    )

    expect(writeFile).not.toHaveBeenCalled()
    expect(deleteFile).not.toHaveBeenCalled()
    expect(lobbyService.startBestOf).not.toHaveBeenCalled()
    expect(remembered.get(HOST)).toEqual({
      line1: 'Before',
      logo: { path: 'best-of-logos/old.png', fileName: 'o' },
    })
  })

  test('refuses an image the safety check rejects before storing anything', async () => {
    isImageSafe.mockResolvedValue(false)
    const file = await upload(await image(100, 100))

    await expect(start({ kind: 'replace', file })).rejects.toEqual(
      codeError(LobbyServiceErrorCode.BestOfLogoInappropriate),
    )

    expect(writeFile).not.toHaveBeenCalled()
    expect(lobbyService.startBestOf).not.toHaveBeenCalled()
    expect(remembered.has(HOST)).toBe(false)
  })

  test('refuses what the lobby refuses before looking at the upload', async () => {
    lobbyService.checkStartBestOf.mockImplementation(() => {
      throw new LobbyServiceError(LobbyServiceErrorCode.NotHost, 'not the host')
    })
    const file = await upload(await image(100, 100))

    await expect(start({ kind: 'replace', file })).rejects.toEqual(
      codeError(LobbyServiceErrorCode.NotHost),
    )

    expect(isImageSafe).not.toHaveBeenCalled()
    expect(writeFile).not.toHaveBeenCalled()
    expect(remembered.has(HOST)).toBe(false)
  })

  test('a host who never started a series has nothing remembered', async () => {
    expect(await service.getRemembered(HOST)).toEqual({})
  })

  test('starting one remembers its lines and logo, and the next start uses the logo', async () => {
    const file = await upload(await image(100, 100), 'brand.png')
    await start({ kind: 'replace', file }, { line1: 'Casters  Alice', line2: 'Observer  Carol' })
    const { filePath } = await lastStored()
    const logo = { url: `https://files.test/${filePath}`, fileName: 'brand.png' }

    expect(await service.getRemembered(HOST)).toEqual({
      line1: 'Casters  Alice',
      line2: 'Observer  Carol',
      logo,
    })

    asMockedFunction(writeFile).mockClear()
    const next = await start({ kind: 'keep' }, { line2: 'Observer  Dan' })

    expect(writeFile).not.toHaveBeenCalled()
    expect(deleteFile).not.toHaveBeenCalled()
    expect(next.overlay).toEqual({ line2: 'Observer  Dan', logo })
    expect(await service.getRemembered(HOST)).toEqual({ line2: 'Observer  Dan', logo })
  })

  test('starting one with the remove flag clears the logo and deletes its file', async () => {
    const previous = { path: 'best-of-logos/aa/bb/old.png', fileName: 'old.png' }
    remembered.set(HOST, { line1: 'Line', logo: previous })

    const bestOf = await start({ kind: 'remove' }, { line1: 'Line' })

    expect(bestOf.overlay).toEqual({ line1: 'Line' })
    expect(remembered.get(HOST)).toEqual({ line1: 'Line' })
    expect(lobbyService.replaceBestOfLogo).toHaveBeenCalledWith(
      'https://files.test/best-of-logos/aa/bb/old.png',
      undefined,
    )
    expect(deleteFile).toHaveBeenCalledWith(previous.path)
  })

  test('saving with a new logo replaces it everywhere and deletes the previous file', async () => {
    const previous = { path: 'best-of-logos/aa/bb/old.png', fileName: 'old.png' }
    remembered.set(HOST, { logo: previous })
    await start()
    const file = await upload(svg(20, 10), 'new.svg')

    const bestOf = await update({ kind: 'replace', file })

    const { filePath } = await lastStored()
    const logo = { url: `https://files.test/${filePath}`, fileName: 'new.svg' }
    expect(bestOf.overlay).toEqual({ logo })
    expect(remembered.get(HOST)).toEqual({ logo: { path: filePath, fileName: 'new.svg' } })
    expect(lobbyService.replaceBestOfLogo).toHaveBeenCalledWith(
      'https://files.test/best-of-logos/aa/bb/old.png',
      logo,
    )
    expect(deleteFile).toHaveBeenCalledWith(previous.path)
    expect(deleteFile).not.toHaveBeenCalledWith(filePath)
  })

  test('saving with the remove flag clears the logo and deletes its file', async () => {
    const previous = { path: 'best-of-logos/aa/bb/old.png', fileName: 'old.png' }
    remembered.set(HOST, { logo: previous })
    await start()

    const bestOf = await update({ kind: 'remove' })

    expect(lobbyService.updateBestOf).toHaveBeenCalledWith(expect.objectContaining({ logo: null }))
    expect(bestOf).not.toHaveProperty('overlay')
    expect(remembered.get(HOST)).toEqual({})
    expect(deleteFile).toHaveBeenCalledWith(previous.path)
  })

  test('saving without touching the logo keeps it, and remembers the lines the series has', async () => {
    const previous = { path: 'best-of-logos/aa/bb/old.png', fileName: 'old.png' }
    remembered.set(HOST, { logo: previous })
    await start({ kind: 'keep' }, { line1: 'Casters  Alice', line2: 'Observer  Carol' })

    await update({ kind: 'keep' }, { line1: null, title: 'Final' })

    expect(lobbyService.updateBestOf).toHaveBeenCalledWith(
      expect.objectContaining({ line1: null, title: 'Final', logo: undefined }),
    )
    // A cleared line is remembered as cleared
    expect(remembered.get(HOST)).toEqual({ line2: 'Observer  Carol', logo: previous })
    expect(deleteFile).not.toHaveBeenCalled()
    expect(lobbyService.replaceBestOfLogo).not.toHaveBeenCalled()
  })

  test('a start the lobby refuses after the upload was stored leaves nothing behind', async () => {
    const previous = { path: 'best-of-logos/aa/bb/old.png', fileName: 'old.png' }
    remembered.set(HOST, { line1: 'Before', logo: previous })
    lobbyService.startBestOf.mockImplementation(() => {
      throw new LobbyServiceError(LobbyServiceErrorCode.CountingDown, 'counting down')
    })
    const file = await upload(await image(100, 100))

    await expect(start({ kind: 'replace', file }, { line1: 'After' })).rejects.toEqual(
      codeError(LobbyServiceErrorCode.CountingDown),
    )

    const { filePath } = await lastStored()
    expect(deleteFile).toHaveBeenCalledWith(filePath)
    expect(deleteFile).not.toHaveBeenCalledWith(previous.path)
    expect(remembered.get(HOST)).toEqual({ line1: 'Before', logo: previous })
    expect(lobbyService.replaceBestOfLogo).not.toHaveBeenCalled()
  })

  test("a host's starts and saves run one after another", async () => {
    await start()
    const first = await upload(await image(100, 100), 'first.png')
    const second = await upload(await image(100, 100), 'second.png')

    const [a, b] = await Promise.all([
      update({ kind: 'replace', file: first }),
      update({ kind: 'replace', file: second }),
    ])

    const [[firstPath], [secondPath]] = asMockedFunction(writeFile).mock.calls
    expect(a.overlay?.logo?.fileName).toBe('first.png')
    expect(b.overlay?.logo?.fileName).toBe('second.png')
    // The second replaced the first, so only the second's file is left
    expect(remembered.get(HOST)!.logo).toEqual({ path: secondPath, fileName: 'second.png' })
    expect(deleteFile).toHaveBeenCalledWith(firstPath)
    expect(deleteFile).not.toHaveBeenCalledWith(secondPath)
  })
})
