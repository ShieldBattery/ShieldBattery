/**
 * The current version of the map parser. Increase this any time we update the underlying code in a
 * way that invalidates the previous data (e.g. adds features, changes results for maps that were
 * successfully parsed before).
 *
 * Incrementing this number will cause older maps to re-parsed on demand.
 */
export const MAP_PARSER_VERSION = 2
