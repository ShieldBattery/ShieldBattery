import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  checkLocalBuildPaths,
  DEFAULT_LOCAL_BUILD_VERSION,
  parseLocalBuildDescriptor,
  validateLocalBuildSpec,
} from './local-builds'

const EXECUTABLE = path.resolve('bots', 'MyBot.exe')
const JAR = path.resolve('bots', 'MyBot.jar')
const WORKING_DIRECTORY = path.resolve('bots')

function makeSpec(overrides: Record<string, unknown> = {}) {
  return {
    name: 'My Bot',
    version: '1.0',
    executable: EXECUTABLE,
    args: ['--fast'],
    workingDirectory: WORKING_DIRECTORY,
    runtime: { kind: 'native' },
    races: ['zerg'],
    ...overrides,
  }
}

describe('app/bots/local-builds/validateLocalBuildSpec', () => {
  test('accepts a native build', () => {
    expect(validateLocalBuildSpec(makeSpec())).toEqual({
      name: 'My Bot',
      version: '1.0',
      executable: EXECUTABLE,
      args: ['--fast'],
      workingDirectory: WORKING_DIRECTORY,
      runtime: { kind: 'native' },
      races: ['zerg'],
    })
  })

  test('accepts a Java build', () => {
    const spec = validateLocalBuildSpec(
      makeSpec({ executable: JAR, runtime: { kind: 'java', major: 17, architecture: 'x86_64' } }),
    )
    expect(spec.runtime).toEqual({ kind: 'java', major: 17, architecture: 'x86_64' })
  })

  test('preserves Java JVM arguments through validation and descriptor parsing', () => {
    const runtime = {
      kind: 'java',
      major: 21,
      architecture: 'x86_64',
      jvmArguments: ['-Xms128m', '-Xmx1024m'],
    }
    expect(validateLocalBuildSpec(makeSpec({ executable: JAR, runtime })).runtime).toEqual(runtime)
    expect(parseLocalBuildDescriptor({ runtime }, path.dirname(JAR)).runtime).toEqual(runtime)
  })

  test('ignores a descriptor runtime with invalid JVM arguments', () => {
    expect(
      parseLocalBuildDescriptor(
        { runtime: { kind: 'java', major: 21, architecture: 'x86_64', jvmArguments: [1] } },
        path.dirname(JAR),
      ),
    ).not.toHaveProperty('runtime')
  })

  test('defaults a missing version', () => {
    expect(validateLocalBuildSpec(makeSpec({ version: '  ' })).version).toBe(
      DEFAULT_LOCAL_BUILD_VERSION,
    )
  })

  test('drops duplicate races', () => {
    expect(validateLocalBuildSpec(makeSpec({ races: ['zerg', 'zerg', 'terran'] })).races).toEqual([
      'zerg',
      'terran',
    ])
  })

  test.each([
    ['an empty name', makeSpec({ name: '  ' })],
    ['a name that is too long', makeSpec({ name: 'x'.repeat(25) })],
    ['a name with characters the game cannot show', makeSpec({ name: 'Бот' })],
    ['a relative executable', makeSpec({ executable: 'MyBot.exe' })],
    ['a relative working directory', makeSpec({ workingDirectory: 'bots' })],
    ['a native build that is not an exe', makeSpec({ executable: JAR })],
    [
      'a Java build that is not a jar',
      makeSpec({ runtime: { kind: 'java', major: 17, architecture: 'x86_64' } }),
    ],
    [
      'a Java build with no major version',
      makeSpec({ executable: JAR, runtime: { kind: 'java' } }),
    ],
    ['an unknown runtime', makeSpec({ runtime: { kind: 'python' } })],
    [
      'JVM arguments that are not a list',
      makeSpec({
        executable: JAR,
        runtime: { kind: 'java', major: 21, architecture: 'x86_64', jvmArguments: '-Xmx1g' },
      }),
    ],
    [
      'JVM arguments that are not text',
      makeSpec({
        executable: JAR,
        runtime: { kind: 'java', major: 21, architecture: 'x86_64', jvmArguments: ['-Xmx1g', 1] },
      }),
    ],
    ['no races', makeSpec({ races: [] })],
    ['an unknown race', makeSpec({ races: ['random'] })],
    ['arguments that are not text', makeSpec({ args: [3] })],
    ['an argument with a null byte', makeSpec({ args: ['a\u0000b'] })],
    ['nothing at all', undefined],
  ])('rejects %s', (_description, spec) => {
    expect(() => validateLocalBuildSpec(spec)).toThrow()
  })
})

describe('app/bots/local-builds/parseLocalBuildDescriptor', () => {
  test('reads what a descriptor supplies', () => {
    const spec = parseLocalBuildDescriptor(
      {
        name: 'My Bot',
        version: 'dev-abc',
        args: ['--fast'],
        workingDirectory: 'profile',
        runtime: { kind: 'java', major: 8, architecture: 'x86' },
        races: ['zerg', 'zerg', 'protoss'],
      },
      WORKING_DIRECTORY,
    )
    expect(spec).toEqual({
      name: 'My Bot',
      version: 'dev-abc',
      args: ['--fast'],
      workingDirectory: path.resolve(WORKING_DIRECTORY, 'profile'),
      runtime: { kind: 'java', major: 8, architecture: 'x86' },
      races: ['zerg', 'protoss'],
    })
  })

  test('ignores fields it cannot use', () => {
    expect(
      parseLocalBuildDescriptor(
        { name: 42, args: 'nope', runtime: { kind: 'python' }, races: ['nope'] },
        WORKING_DIRECTORY,
      ),
    ).toEqual({})
  })

  test('ignores a descriptor that is not an object', () => {
    expect(parseLocalBuildDescriptor('nope', WORKING_DIRECTORY)).toEqual({})
  })
})

describe('app/bots/local-builds/checkLocalBuildPaths', () => {
  let directory: string

  beforeAll(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sb-local-build-'))
    await fs.writeFile(path.join(directory, 'MyBot.exe'), 'not really an executable')
  })

  afterAll(async () => {
    await fs.rm(directory, { recursive: true, force: true })
  })

  test('accepts files that are there', async () => {
    await expect(
      checkLocalBuildPaths(
        validateLocalBuildSpec(
          makeSpec({
            executable: path.join(directory, 'MyBot.exe'),
            workingDirectory: directory,
          }),
        ),
      ),
    ).resolves.toBeUndefined()
  })

  test('rejects a missing executable', async () => {
    await expect(
      checkLocalBuildPaths(
        validateLocalBuildSpec(
          makeSpec({
            executable: path.join(directory, 'Missing.exe'),
            workingDirectory: directory,
          }),
        ),
      ),
    ).rejects.toThrow(/Can't find the bot executable/)
  })

  test('rejects a missing folder', async () => {
    await expect(
      checkLocalBuildPaths(
        validateLocalBuildSpec(
          makeSpec({
            executable: path.join(directory, 'MyBot.exe'),
            workingDirectory: path.join(directory, 'missing'),
          }),
        ),
      ),
    ).rejects.toThrow(/Can't find the bot folder/)
  })
})
