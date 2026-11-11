/**
 * Bring-your-own bots: a developer points the app at an executable they built themselves. Nothing
 * about it is reviewed, so the only guarantees are the ones checked here — that what gets launched
 * is an absolute path to a file that exists, with arguments the launcher can pass without a shell.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import {
  ALL_BOT_RACE_NAMES,
  BotArchitecture,
  BotFormatSupportInfo,
  BotRaceName,
} from '../../common/bots/bot-catalog'
import { LocalBuildBotSpec } from '../../common/bots/bot-library'

/** The launch API's name rule: 1-24 printable ASCII characters. */
const NAME_PATTERN = /^[\x20-\x7e]{1,24}$/
const MAX_VERSION_LENGTH = 32
const MAX_ARGUMENTS = 64

const RACE_NAMES = new Set<BotRaceName>(ALL_BOT_RACE_NAMES)
const ARCHITECTURES = new Set<BotArchitecture>(['x86', 'x86_64'])

/** The version label used when a build doesn't name one. */
export const DEFAULT_LOCAL_BUILD_VERSION = 'dev'

/** The descriptor a developer can drop next to their executable to prefill the add-bot form. */
export const LOCAL_BUILD_DESCRIPTOR_NAME = 'sb-bot.json'

/**
 * Nobody has tested a local build in any format, so it starts out unverified everywhere: the UI
 * warns about the format rather than blocking it.
 */
export function defaultLocalBuildFormats(): BotFormatSupportInfo[] {
  return [
    { id: 'one-v-one', support: 'unverified', notes: '' },
    { id: 'teams', support: 'unverified', notes: '' },
    { id: 'free-for-all', support: 'unverified', notes: '' },
  ]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validateRuntime(value: unknown): LocalBuildBotSpec['runtime'] {
  if (!isRecord(value)) {
    throw new Error('Choose a runtime for this bot')
  }
  if (value.kind === 'native') {
    return { kind: 'native' }
  }
  if (value.kind === 'java') {
    if (typeof value.major !== 'number' || !Number.isSafeInteger(value.major) || value.major <= 0) {
      throw new Error('Enter the Java major version this bot needs')
    }
    const architecture = value.architecture
    if (typeof architecture !== 'string' || !ARCHITECTURES.has(architecture as BotArchitecture)) {
      throw new Error('Choose whether this bot needs a 32-bit or 64-bit Java runtime')
    }
    let jvmArguments: string[] | undefined
    if (value.jvmArguments !== undefined) {
      if (!Array.isArray(value.jvmArguments)) {
        throw new Error('JVM arguments must be a list')
      }
      if (value.jvmArguments.length > MAX_ARGUMENTS) {
        throw new Error('Enter at most ' + MAX_ARGUMENTS + ' JVM arguments')
      }
      jvmArguments = value.jvmArguments.map(argument => {
        if (typeof argument !== 'string' || argument.includes('\0')) {
          throw new Error('JVM arguments must be text')
        }
        return argument
      })
    }
    return {
      kind: 'java',
      major: value.major,
      architecture: architecture as BotArchitecture,
      ...(jvmArguments === undefined ? {} : { jvmArguments }),
    }
  }
  throw new Error('Choose a runtime for this bot')
}

/**
 * Checks and normalizes what the UI collected for a local build. Throws with a message meant for
 * the user; path existence is checked separately by {@link checkLocalBuildPaths}.
 */
export function validateLocalBuildSpec(value: unknown): LocalBuildBotSpec {
  if (!isRecord(value)) {
    throw new Error('Fill in this bot before saving it')
  }

  const name = typeof value.name === 'string' ? value.name.trim() : ''
  if (!NAME_PATTERN.test(name)) {
    throw new Error('Enter a name of 1 to 24 letters, numbers or symbols')
  }

  const versionValue = typeof value.version === 'string' ? value.version.trim() : ''
  const version = versionValue.length ? versionValue : DEFAULT_LOCAL_BUILD_VERSION
  if (version.length > MAX_VERSION_LENGTH) {
    throw new Error(`Enter a version of at most ${MAX_VERSION_LENGTH} characters`)
  }

  const executable = typeof value.executable === 'string' ? value.executable.trim() : ''
  if (!executable || !path.isAbsolute(executable)) {
    throw new Error('Choose the bot executable')
  }
  const runtime = validateRuntime(value.runtime)
  const extension = path.extname(executable).toLowerCase()
  if (runtime.kind === 'java' && extension !== '.jar') {
    throw new Error('A Java bot runs from a .jar file')
  }
  if (runtime.kind === 'native' && extension !== '.exe') {
    throw new Error('A native bot runs from an .exe file')
  }

  const workingDirectoryValue =
    typeof value.workingDirectory === 'string' ? value.workingDirectory.trim() : ''
  if (!workingDirectoryValue || !path.isAbsolute(workingDirectoryValue)) {
    throw new Error(`Choose the folder the bot runs from`)
  }

  if (!Array.isArray(value.args)) {
    throw new Error('Arguments must be a list')
  }
  if (value.args.length > MAX_ARGUMENTS) {
    throw new Error(`Enter at most ${MAX_ARGUMENTS} arguments`)
  }
  const args = value.args.map(arg => {
    if (typeof arg !== 'string' || arg.includes('\0')) {
      throw new Error('Arguments must be text')
    }
    return arg
  })

  if (!Array.isArray(value.races) || value.races.length === 0) {
    throw new Error('Choose at least one race this bot can play')
  }
  const races: BotRaceName[] = []
  for (const race of value.races) {
    if (typeof race !== 'string' || !RACE_NAMES.has(race as BotRaceName)) {
      throw new Error('Choose at least one race this bot can play')
    }
    if (!races.includes(race as BotRaceName)) {
      races.push(race as BotRaceName)
    }
  }

  return {
    name,
    version,
    executable: path.normalize(executable),
    args,
    workingDirectory: path.normalize(workingDirectoryValue),
    runtime,
    races,
  }
}

/** Confirms the files a local build names are actually there, with messages meant for the user. */
export async function checkLocalBuildPaths(spec: LocalBuildBotSpec): Promise<void> {
  try {
    if (!(await fs.stat(spec.executable)).isFile()) {
      throw new Error('not a file')
    }
  } catch {
    throw new Error(`Can't find the bot executable at ${spec.executable}`)
  }
  try {
    if (!(await fs.stat(spec.workingDirectory)).isDirectory()) {
      throw new Error('not a directory')
    }
  } catch {
    throw new Error(`Can't find the bot folder at ${spec.workingDirectory}`)
  }
}

/**
 * Reads whatever a developer's `sb-bot.json` supplies, ignoring anything malformed: this only
 * prefills a form the user then confirms. A relative `workingDirectory` is resolved against the
 * descriptor's own directory, so a build tree can be described without absolute paths.
 */
export function parseLocalBuildDescriptor(
  value: unknown,
  descriptorDirectory: string,
): Partial<LocalBuildBotSpec> {
  if (!isRecord(value)) {
    return {}
  }

  const spec: Partial<LocalBuildBotSpec> = {}
  if (typeof value.name === 'string' && value.name.trim()) {
    spec.name = value.name.trim().slice(0, 24)
  }
  if (typeof value.version === 'string' && value.version.trim()) {
    spec.version = value.version.trim().slice(0, MAX_VERSION_LENGTH)
  }
  if (Array.isArray(value.args) && value.args.every(arg => typeof arg === 'string')) {
    spec.args = (value.args as string[]).filter(arg => !arg.includes('\0')).slice(0, MAX_ARGUMENTS)
  }
  if (typeof value.workingDirectory === 'string' && value.workingDirectory.trim()) {
    spec.workingDirectory = path.resolve(descriptorDirectory, value.workingDirectory.trim())
  }
  try {
    spec.runtime = validateRuntime(value.runtime)
  } catch {
    // An unusable runtime just leaves the form on its default.
  }
  if (Array.isArray(value.races)) {
    const races = value.races.filter(
      (race): race is BotRaceName =>
        typeof race === 'string' && RACE_NAMES.has(race as BotRaceName),
    )
    if (races.length) {
      spec.races = Array.from(new Set(races))
    }
  }
  return spec
}
