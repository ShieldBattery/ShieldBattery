import { BotCatalogEntry } from './bot-catalog'
import { BotLibrarySnapshot, InstalledBotRelease } from './bot-library'

/** Approval comes from the current signed catalog, never from an installed record. */
export function isProductionApproved(
  installed: InstalledBotRelease,
  entries: ReadonlyArray<BotCatalogEntry>,
): boolean {
  return !!entries
    .find(entry => entry.bot.id === installed.botId)
    ?.releases.some(
      release =>
        release.releaseStatus === 'production-approved' &&
        release.package.releaseId === installed.releaseId &&
        release.artifact.sha256 === installed.digest,
    )
}

/** Development can inspect candidates; production exposes only explicitly approved releases. */
export function botLibraryForBuild(
  snapshot: BotLibrarySnapshot,
  isDev: boolean,
): BotLibrarySnapshot {
  if (isDev) return snapshot

  const entries = snapshot.catalog?.bots ?? []
  const bots = entries.flatMap(entry => {
    const releases = entry.releases.filter(r => r.releaseStatus === 'production-approved')
    return releases.length ? [{ ...entry, releases }] : []
  })
  const isVisibleRelease = (botId: string, releaseId: string) =>
    bots.some(
      entry =>
        entry.bot.id === botId &&
        entry.releases.some(release => release.package.releaseId === releaseId),
    )
  return {
    ...snapshot,
    catalog: snapshot.catalog ? { ...snapshot.catalog, bots } : undefined,
    installed: snapshot.installed.filter(installed => isProductionApproved(installed, bots)),
    localBuilds: [],
    installs: snapshot.installs.filter(install =>
      isVisibleRelease(install.botId, install.releaseId),
    ),
    installFailures: snapshot.installFailures.filter(failure =>
      isVisibleRelease(failure.botId, failure.releaseId),
    ),
  }
}
