import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { BotCatalogRelease } from '../../common/bots/bot-catalog'
import { PLUTO_V2_RELEASE } from '../../common/bots/pluto-v2'
import { validateBotPackage } from './catalog'
import { verifyPackageContents } from './installer'

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pluto-installer-'))
  const companion = Buffer.from('fixture companion')
  const pkg = validateBotPackage(
    {
      schemaVersion: 1,
      botId: 'pluto',
      releaseId: 'pluto-test',
      version: 'test',
      platform: { os: 'windows', architecture: 'x86' },
      runtime: { kind: 'pluto-v2', companionSha256: hash(companion) },
      launch: { entrypoint: 'work/pluto-companion.dll', arguments: [], workingDirectory: 'work' },
      profile: {
        selectableRaces: ['terran'],
        randomRace: 'unsupported',
        formats: [{ id: 'one-v-one', support: 'experimental', notes: 'fixture' }],
        mapConstraints: [],
        learning: { mode: 'persistent', notes: 'fixture' },
      },
      bwapi: { version: '4.4.0', protocol: 10003, minimumBridgeVersion: 'pluto-v2-catalog-1' },
      sources: [
        { id: 'fixture', repository: 'https://example.test/fixture.git', revision: 'a'.repeat(40) },
      ],
      licenses: [{ name: 'Fixture', noticePath: 'NOTICE.txt' }],
      permissions: {
        localDistribution: { status: 'approved', evidence: 'fixture only' },
        publicCompetition: { status: 'unreviewed', evidence: 'fixture' },
      },
      writableDirectories: ['work/bwapi-data/write'],
      build: {
        recipeSource: {
          id: 'fixture',
          repository: 'https://example.test/fixture.git',
          revision: 'a'.repeat(40),
        },
        recipePath: 'fixture.ts',
        toolchain: 'fixture',
      },
      sourceReview: { status: 'pending', evidence: 'test-only fixture' },
    },
    'package',
    'pluto',
  )
  const descriptor = JSON.stringify(pkg)
  const release: BotCatalogRelease = {
    package: pkg,
    artifact: {
      url: 'https://example.test/fixture.zip',
      sizeBytes: 1,
      sha256: 'a'.repeat(64),
      manifestSha256: hash(descriptor),
      format: 'zip',
    },
  }
  await fs.mkdir(path.join(directory, 'work'))
  await fs.writeFile(path.join(directory, 'work/pluto-companion.dll'), companion)
  await fs.writeFile(path.join(directory, 'package.json'), descriptor)
  await fs.writeFile(path.join(directory, 'NOTICE.txt'), 'fixture')
  await fs.writeFile(path.join(directory, 'pluto-upstream.json'), JSON.stringify(PLUTO_V2_RELEASE))
  return { directory, release }
}

test('catalog companion is verified before original model provisioning', async () => {
  const f = await fixture()
  try {
    await expect(verifyPackageContents(f.directory, f.release)).resolves.toBeUndefined()
    await fs.writeFile(path.join(f.directory, 'work/pluto-companion.dll'), 'tampered')
    await expect(verifyPackageContents(f.directory, f.release)).rejects.toThrow(/hash mismatch/)
  } finally {
    await fs.rm(f.directory, { recursive: true, force: true })
  }
})

test('catalog cannot redirect Pluto model provisioning to another upstream', async () => {
  const f = await fixture()
  try {
    await fs.writeFile(
      path.join(f.directory, 'pluto-upstream.json'),
      JSON.stringify({ ...PLUTO_V2_RELEASE, url: 'https://example.test/changed.zip' }),
    )
    await expect(verifyPackageContents(f.directory, f.release)).rejects.toThrow(
      'Unsupported Pluto model release',
    )
  } finally {
    await fs.rm(f.directory, { recursive: true, force: true })
  }
})
