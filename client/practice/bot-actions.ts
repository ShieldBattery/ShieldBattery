import { BotCatalogRelease, BotRuntime, latestCatalogRelease } from '../../common/bots/bot-catalog'
import { BotView } from '../../common/bots/bot-view'
import { TypedIpcRenderer } from '../../common/ipc'
import { openSimpleDialog } from '../dialogs/action-creators'
import { dispatch } from '../dispatch-registry'
import i18n from '../i18n/i18next'
import { jotaiStore } from '../jotai-store'
import logger from '../logging/logger'
import { botLibraryAtom } from './practice-atoms'

const ipcRenderer = new TypedIpcRenderer()

/** The error's own words, without the wrapper Electron adds to errors thrown across IPC. */
function errorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  return message.replace(/^Error invoking remote method '[^']*': (?:Error: )?/, '')
}

function showFailure(title: string, err: unknown): void {
  logger.error(`${title}: ${(err as any)?.stack ?? err}`)
  dispatch(openSimpleDialog(title, errorMessage(err)))
}

/** The release that would be installed for a catalog bot: the newer one if the catalog has it. */
function releaseToInstall(bot: BotView): BotCatalogRelease | undefined {
  if (bot.updateAvailable) {
    return bot.updateAvailable
  }
  return bot.catalogEntry ? latestCatalogRelease(bot.catalogEntry) : undefined
}

function noReleaseFailure(bot: BotView): void {
  dispatch(
    openSimpleDialog(
      i18n.t('practice.botActions.downloadFailedTitle', {
        defaultValue: "Couldn't download {{name}}",
        name: bot.name,
      }),
      i18n.t(
        'practice.botActions.noRelease',
        'This bot has no downloadable release right now. Refresh the bot list and try again.',
      ),
    ),
  )
}

/** Downloads and installs the newest catalog release for a bot, clearing any previous failure. */
export async function installBot(bot: BotView): Promise<void> {
  const release = releaseToInstall(bot)
  if (!release) {
    noReleaseFailure(bot)
    return
  }

  try {
    if (bot.readiness.state === 'installFailed') {
      await ipcRenderer.invoke('botLibraryClearInstallFailure', bot.key)
    }
    await ipcRenderer.invoke('botLibraryInstall', bot.key, release.package.releaseId)
  } catch (err) {
    showFailure(
      i18n.t('practice.botActions.downloadFailedTitle', {
        defaultValue: "Couldn't download {{name}}",
        name: bot.name,
      }),
      err,
    )
  }
}

/** Installs the newer catalog release. The installed one keeps working until this finishes. */
export async function updateBot(bot: BotView): Promise<void> {
  if (!bot.updateAvailable) {
    noReleaseFailure(bot)
    return
  }

  try {
    await ipcRenderer.invoke('botLibraryInstall', bot.key, bot.updateAvailable.package.releaseId)
  } catch (err) {
    showFailure(
      i18n.t('practice.botActions.updateFailedTitle', {
        defaultValue: "Couldn't update {{name}}",
        name: bot.name,
      }),
      err,
    )
  }
}

export async function cancelInstall(bot: BotView): Promise<void> {
  try {
    await ipcRenderer.invoke('botLibraryCancelInstall', bot.key)
  } catch (err) {
    showFailure(
      i18n.t('practice.botActions.cancelFailedTitle', {
        defaultValue: "Couldn't cancel the download of {{name}}",
        name: bot.name,
      }),
      err,
    )
  }
}

/** Removes the bot's files from this PC. Learning data is kept. */
export async function removeBot(bot: BotView): Promise<void> {
  try {
    if (bot.source === 'local') {
      await ipcRenderer.invoke('botLibraryRemoveLocalBuild', bot.key)
    } else {
      await ipcRenderer.invoke('botLibraryRemove', bot.key)
    }
  } catch (err) {
    showFailure(
      i18n.t('practice.botActions.removeFailedTitle', {
        defaultValue: "Couldn't remove {{name}}",
        name: bot.name,
      }),
      err,
    )
  }
}

/** Asks for a `java.exe` to run this bot with, overriding whatever was detected. */
export async function pickJavaFor(bot: BotView): Promise<void> {
  try {
    const javaPath = await ipcRenderer.invoke('botLibraryPickJava')
    if (!javaPath) {
      return
    }
    await ipcRenderer.invoke('botLibrarySetJavaOverride', bot.key, javaPath)
  } catch (err) {
    showFailure(
      i18n.t('practice.botActions.javaPickFailedTitle', "Couldn't use that Java install"),
      err,
    )
  }
}

/** Re-scans this PC for installed Java runtimes. */
export async function detectJava(): Promise<void> {
  try {
    await ipcRenderer.invoke('botLibraryDetectJava')
  } catch (err) {
    showFailure(i18n.t('practice.botActions.javaDetectFailedTitle', "Couldn't check for Java"), err)
  }
}

/** Returns a bot's saved history to the baseline shipped in its package. */
export async function resetLearning(bot: BotView): Promise<void> {
  try {
    await ipcRenderer.invoke('botLibraryResetLearning', bot.key)
  } catch (err) {
    showFailure(
      i18n.t('practice.botActions.resetLearningFailedTitle', {
        defaultValue: "Couldn't reset {{name}}'s learning",
        name: bot.name,
      }),
      err,
    )
  }
}

/** Opens the vendor's download page for the runtime a bot needs. */
export function openGetJavaLink(runtime: BotRuntime): void {
  if (runtime.kind !== 'java') {
    return
  }

  const arch = runtime.architecture === 'x86' ? 'x86' : 'x64'
  window.open(
    `https://adoptium.net/temurin/releases/?version=${runtime.major}&os=windows&arch=${arch}`,
    '_blank',
    'noopener,noreferrer',
  )
}

/** Re-fetches the bot catalog. A failed fetch leaves the cached catalog in place. */
export async function refreshCatalog(): Promise<void> {
  try {
    const snapshot = await ipcRenderer.invoke('botLibraryRefreshCatalog')
    if (snapshot) {
      jotaiStore.set(botLibraryAtom, snapshot)
    }
  } catch (err) {
    showFailure(
      i18n.t('practice.botActions.catalogRefreshFailedTitle', "Couldn't refresh the bot list"),
      err,
    )
  }
}

/** Opens the folder a bot's files live in. */
export async function openBotFolder(bot: BotView): Promise<void> {
  try {
    await ipcRenderer.invoke('botLibraryOpenFolder', bot.key)
  } catch (err) {
    showFailure(
      i18n.t('practice.botActions.openFolderFailedTitle', "Couldn't open the bot's folder"),
      err,
    )
  }
}

/** Opens the folder holding the logs for local games (or one session's logs). */
export async function openPracticeLogs(sessionId?: string): Promise<void> {
  try {
    await ipcRenderer.invoke('practiceOpenLogs', sessionId)
  } catch (err) {
    showFailure(i18n.t('practice.botActions.openLogsFailedTitle', "Couldn't open the logs"), err)
  }
}

/**
 * Starts async work from an event handler. These actions surface their own failures to the user, so
 * anything that still escapes is only logged.
 */
export function runAsyncAction(work: Promise<unknown>): void {
  work.catch(err => {
    logger.error(`A practice action failed unexpectedly: ${err?.stack ?? err}`)
  })
}
