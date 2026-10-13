import { mkdtemp, rm, writeFile as writeLocalFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { Result } from 'typescript-result'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { asMockedFunction } from '../../../common/testing/mocks'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { parseReplay } from '../../workers/replays/replays'
import { deleteFile, writeFile } from '../files'
import { Clock } from '../time/clock'
import {
  claimExpiredReplaySessionUploads,
  createReplaySessionUpload,
  deleteClaimedReplaySessionUploads,
  deleteReplaySessionUpload,
  releaseReplaySessionUploadClaims,
  ReplaySessionUpload,
  retainReplaySessionUploadForOwner,
  retainReplaySessionUploads,
} from './replay-session-source-models'
import {
  ReplaySessionSourceErrorCode,
  ReplaySessionSourceService,
  replaySessionUploadPath,
} from './replay-session-source-service'

vi.mock('../../workers/replays/replays', () => ({ parseReplay: vi.fn() }))

vi.mock('../files', () => ({
  deleteFile: vi.fn(),
  writeFile: vi.fn(),
}))

vi.mock('./replay-session-source-models', () => ({
  createReplaySessionUpload: vi.fn(),
  claimExpiredReplaySessionUploads: vi.fn(),
  deleteClaimedReplaySessionUploads: vi.fn(),
  deleteReplaySessionUpload: vi.fn(),
  releaseReplaySessionUploadClaims: vi.fn(),
  retainReplaySessionUploadForOwner: vi.fn(),
  retainReplaySessionUploads: vi.fn(),
}))

const OWNER = makeSbUserId(1)
const OTHER_USER = makeSbUserId(2)
const NOW = new Date('2026-10-13T12:00:00.000Z')

function parsedReplay() {
  return {
    parserVersion: 1,
    header: {
      mapName: 'Fighting Spirit',
      gameType: 'Melee',
      frames: 1234,
    },
    slots: [],
  } as any
}

function makeUpload(overrides: Partial<ReplaySessionUpload> = {}): ReplaySessionUpload {
  return {
    id: 'source-id',
    ownerUserId: OWNER,
    hash: Buffer.from('source-hash'),
    size: 4,
    parserVersion: 1,
    header: parsedReplay().header,
    slots: [],
    sbData: null,
    createdAt: NOW,
    expiresAt: new Date(NOW.getTime() + 24 * 60 * 60 * 1000),
    ...overrides,
  }
}

describe('ReplaySessionSourceService', () => {
  let tempDir: string
  let service: ReplaySessionSourceService

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'sb-replay-session-source-test-'))
    const clock = new Clock()
    vi.spyOn(clock, 'now').mockReturnValue(NOW.getTime())
    service = new ReplaySessionSourceService(clock)

    vi.clearAllMocks()
    asMockedFunction(writeFile).mockImplementation(async (_filename, data) => {
      if (!Buffer.isBuffer(data)) {
        for await (const chunk of data) {
          // Consume the stream so the temporary file is closed before test cleanup runs.
          if (!chunk) {
            throw new Error('empty stream chunk')
          }
        }
      }
    })
    asMockedFunction(deleteFile).mockResolvedValue(undefined)
    asMockedFunction(deleteReplaySessionUpload).mockResolvedValue(undefined)
    asMockedFunction(createReplaySessionUpload).mockImplementation(async upload => {
      return makeUpload(upload)
    })
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  async function localReplayFile(): Promise<string> {
    const filePath = path.join(tempDir, 'local.rep')
    await writeLocalFile(filePath, 'replay contents')
    return filePath
  }

  test('rejects an invalid replay before creating a source or writing storage', async () => {
    asMockedFunction(parseReplay).mockResolvedValue(Result.error(new Error('corrupt replay')))
    const filePath = await localReplayFile()

    await expect(service.stageUpload(filePath, OWNER)).rejects.toMatchObject({
      code: ReplaySessionSourceErrorCode.InvalidReplay,
    })

    expect(createReplaySessionUpload).not.toHaveBeenCalled()
    expect(writeFile).not.toHaveBeenCalled()
  })

  test('stores the replay privately and exposes only the source identifier and display metadata', async () => {
    asMockedFunction(parseReplay).mockResolvedValue(Result.ok(parsedReplay()))
    const filePath = await localReplayFile()

    await expect(service.stageUpload(filePath, OWNER)).resolves.toEqual({
      sourceId: 'source-id',
      hash: '03b711b4587bdc8fdc4ba7b224dd1a1ae483264624a74bad40db5bd02b9d37d4',
      size: 15,
      metadata: {
        mapName: 'Fighting Spirit',
        gameType: 'Melee',
        durationFrames: 1234,
      },
    })

    expect(writeFile).toHaveBeenCalledWith(
      replaySessionUploadPath('source-id'),
      expect.anything(),
      {
        acl: 'private',
        type: 'application/octet-stream',
      },
    )
  })

  test('keeps a source row for expiry cleanup if failed storage cannot be removed', async () => {
    asMockedFunction(parseReplay).mockResolvedValue(Result.ok(parsedReplay()))
    asMockedFunction(writeFile).mockRejectedValue(new Error('storage write failed'))
    asMockedFunction(deleteFile).mockRejectedValue(new Error('storage delete failed'))

    await expect(service.stageUpload(await localReplayFile(), OWNER)).rejects.toThrow(
      'storage write failed',
    )
    expect(deleteReplaySessionUpload).not.toHaveBeenCalled()
  })

  test('does not resolve expired sources or sources owned by a different user', async () => {
    asMockedFunction(retainReplaySessionUploadForOwner).mockResolvedValue(undefined)

    await expect(service.retainSourceForOwner('expired-source', OWNER)).resolves.toBeUndefined()
    await expect(
      service.retainSourceForOwner('other-users-source', OTHER_USER),
    ).resolves.toBeUndefined()

    expect(retainReplaySessionUploadForOwner).toHaveBeenNthCalledWith(
      1,
      'expired-source',
      OWNER,
      NOW,
      new Date(NOW.getTime() + 24 * 60 * 60 * 1000),
    )
    expect(retainReplaySessionUploadForOwner).toHaveBeenNthCalledWith(
      2,
      'other-users-source',
      OTHER_USER,
      NOW,
      new Date(NOW.getTime() + 24 * 60 * 60 * 1000),
    )
  })

  test('retains in-use sources for another full lifetime', async () => {
    asMockedFunction(retainReplaySessionUploads).mockResolvedValue(['live'])

    await expect(service.retainSources(['live', 'expired'])).resolves.toEqual(new Set(['live']))

    expect(retainReplaySessionUploads).toHaveBeenCalledWith(
      ['live', 'expired'],
      NOW,
      new Date(NOW.getTime() + 24 * 60 * 60 * 1000),
    )
  })

  test('claims expired rows in one query before removing each corresponding private file', async () => {
    asMockedFunction(claimExpiredReplaySessionUploads).mockResolvedValue([
      'expired-one',
      'expired-two',
    ])
    asMockedFunction(deleteFile)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('storage unavailable'))

    await expect(service.removeExpiredSources()).resolves.toBeUndefined()

    expect(claimExpiredReplaySessionUploads).toHaveBeenCalledWith(
      NOW,
      new Date(NOW.getTime() - 5 * 60 * 1000),
      expect.any(String),
    )
    expect(deleteFile).toHaveBeenCalledTimes(2)
    expect(deleteFile).toHaveBeenCalledWith(replaySessionUploadPath('expired-one'))
    expect(deleteFile).toHaveBeenCalledWith(replaySessionUploadPath('expired-two'))
    const cleanupToken = asMockedFunction(claimExpiredReplaySessionUploads).mock.calls[0][2]
    expect(deleteClaimedReplaySessionUploads).toHaveBeenCalledWith(
      ['expired-one'],
      cleanupToken,
      NOW,
    )
    expect(releaseReplaySessionUploadClaims).toHaveBeenCalledWith(['expired-two'], cleanupToken)
  })

  test('removes the row when an expired upload has no stored file', async () => {
    asMockedFunction(claimExpiredReplaySessionUploads).mockResolvedValue(['missing'])
    asMockedFunction(deleteFile).mockRejectedValue(
      Object.assign(new Error('file not found'), { code: 'ENOENT' }),
    )

    await service.removeExpiredSources()

    expect(deleteClaimedReplaySessionUploads).toHaveBeenCalledWith(
      ['missing'],
      expect.any(String),
      NOW,
    )
  })
})
