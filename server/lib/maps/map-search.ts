import { sql, SqlTemplate } from '../db/sql'

/**
 * Returns a condition matching maps (aliased `m`) whose name or file title matches `query`: every
 * word of the query appears in it, or the query with its spaces removed appears in it with its
 * spaces removed. Both sides are normalized by `map_search_normalize`, so case and punctuation
 * don't matter, and no character in the query acts as a wildcard. A query with no letters or
 * digits matches every map.
 */
export function mapNameMatches(query: string): SqlTemplate {
  return sql`(
    NOT EXISTS (
      SELECT 1
      FROM unnest(string_to_array(map_search_normalize(${query}), ' ')) AS token
      WHERE strpos(m.search_name, token) = 0
    )
    OR strpos(m.search_compact, replace(map_search_normalize(${query}), ' ', '')) > 0
  )`
}
