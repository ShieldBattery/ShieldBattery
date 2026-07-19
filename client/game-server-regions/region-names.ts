import { TFunction } from 'i18next'
import { GameServerRegion } from '../../common/game-server-regions'

/**
 * Localized display names for the game server regions the coordinator is known to serve, keyed by
 * region id. Region ids are opaque server-provided strings, so this list can't be exhaustive by
 * construction — a region with no entry here falls back to its coordinator-served `displayName`
 * (English) until an entry is added. Written as inline `t()` calls with string-literal keys so
 * i18next-parser can statically extract them — a dynamic `t(key)` is invisible to the extractor,
 * which (with `keepRemoved: false`) would drop the keys from the catalog.
 */
const LOCALIZED_REGION_NAMES: ReadonlyMap<string, (t: TFunction) => string> = new Map([
  ['us-east', t => t('gameServerRegions.name.us-east', 'US East')],
  ['us-west', t => t('gameServerRegions.name.us-west', 'US West')],
  ['eu-central', t => t('gameServerRegions.name.eu-central', 'EU Central')],
  ['kr', t => t('gameServerRegions.name.kr', 'Korea')],
  ['ca-east', t => t('gameServerRegions.name.ca-east', 'Canada East')],
  ['sa-east', t => t('gameServerRegions.name.sa-east', 'SA East')],
  ['eu-north', t => t('gameServerRegions.name.eu-north', 'EU North')],
  ['hk', t => t('gameServerRegions.name.hk', 'Hong Kong')],
  ['sg', t => t('gameServerRegions.name.sg', 'Singapore')],
  ['au', t => t('gameServerRegions.name.au', 'Australia')],
  ['mx', t => t('gameServerRegions.name.mx', 'Mexico')],
])

/**
 * Returns the localized display name for a game server region, falling back to the
 * coordinator-served `displayName` for regions without a translation entry.
 */
export function getRegionDisplayName(region: GameServerRegion, t: TFunction): string {
  return LOCALIZED_REGION_NAMES.get(region.id)?.(t) ?? region.displayName
}
