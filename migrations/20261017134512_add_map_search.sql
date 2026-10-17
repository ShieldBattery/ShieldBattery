-- Used for fuzzy matching and ranking map searches (`word_similarity`). A trusted extension, so the
-- database owner can create it.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Normalizes text for map search: lowercased, with every run of characters that aren't letters or
-- digits (Hangul and Han count as letters) collapsed into a single space, and trimmed. Search
-- queries go through this same function, so `1.4` in a query matches `1.4` in a name (both become
-- `1 4`). Changing it requires recomputing the generated columns that use it
-- (`UPDATE maps SET title = title`).
CREATE FUNCTION map_search_normalize(t text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  RETURN btrim(regexp_replace(lower(t), '[^[:alnum:]]+', ' ', 'g'));

-- Generated column expressions must be immutable, so these use `||` and COALESCE rather than
-- concat/concat_ws (which are only stable). Generated columns can't reference other generated
-- columns, so each one repeats the expressions it depends on.
ALTER TABLE maps
  -- The public name and the file's title, both searchable at the same tier: players search for the
  -- name they saw in game as well as the one shown in listings.
  ADD COLUMN search_name text NOT NULL GENERATED ALWAYS AS
    (map_search_normalize(COALESCE(public_name || ' ', '') || title)) STORED,
  -- `search_name` without spaces, so a query that leaves spaces out (or puts them elsewhere) still
  -- matches, e.g. "마린키우기" against "마린 키우기".
  ADD COLUMN search_compact text NOT NULL GENERATED ALWAYS AS
    (replace(map_search_normalize(COALESCE(public_name || ' ', '') || title), ' ', '')) STORED,
  ADD COLUMN search_description text NOT NULL GENERATED ALWAYS AS
    (map_search_normalize(COALESCE(public_description, description))) STORED,
  -- The display name with leading parenthesized prefixes (`(4)`, `(3v3)`), bracketed tags
  -- (`[EUD]`) and punctuation removed, so `(4)Lights Out` sorts under L. Falls back to the full name
  -- if nothing would be left.
  ADD COLUMN sort_name text NOT NULL GENERATED ALWAYS AS
    (COALESCE(
      NULLIF(
        regexp_replace(COALESCE(public_name, title), '^((\([^)]*\))|(\[[^]]*\])|[^[:alnum:]])+', ''),
        ''
      ),
      COALESCE(public_name, title)
    )) STORED,
  -- `melee` or `ums`. A map is UMS if it can't seat two players in melee, uses EUDs, or has a force
  -- slot that is a computer or has a fixed race.
  ADD COLUMN kind text NOT NULL GENERATED ALWAYS AS
    (CASE
      WHEN players_melee < 2 OR is_eud OR jsonb_path_exists(lobby_init_data,
        '$.forces[*].players[*] ? (@.computer == true || @.race != "any")')
      THEN 'ums'
      ELSE 'melee'
    END) STORED,
  -- The number of player slots for the map's kind, falling back to the other kind's count when
  -- that one is 0.
  ADD COLUMN player_count integer NOT NULL GENERATED ALWAYS AS
    (CASE
      WHEN players_melee < 2 OR is_eud OR jsonb_path_exists(lobby_init_data,
        '$.forces[*].players[*] ? (@.computer == true || @.race != "any")')
      THEN CASE WHEN players_ums > 0 THEN players_ums ELSE players_melee END
      ELSE CASE WHEN players_melee > 0 THEN players_melee ELSE players_ums END
    END) STORED;

-- Lobby-only play counts, the inputs of the trending score. Matchmaking games are left out: the
-- matchmaker picks those maps, so a new map pool would otherwise dominate trending every season.
ALTER TABLE map_stats
  ADD COLUMN lobby_games_7d integer NOT NULL DEFAULT 0,
  ADD COLUMN lobby_games_28d integer NOT NULL DEFAULT 0,
  -- Distinct users who played the map in a lobby game in the last 7 days.
  ADD COLUMN lobby_players_7d integer NOT NULL DEFAULT 0,
  -- How far this week's lobby games exceed what the 3 weeks before it predict, in standard
  -- deviations of a Poisson count, times 100. The `+ 5` keeps a map with no history from scoring
  -- infinitely high. Maps played by fewer than 5 people this week, and maps that aren't rising,
  -- score 0.
  ADD COLUMN trending_score integer NOT NULL GENERATED ALWAYS AS
    (CASE
      WHEN lobby_players_7d >= 5 THEN
        greatest(0, round(
          100 * (lobby_games_7d - greatest(lobby_games_28d - lobby_games_7d, 0) / 3.0) /
            sqrt(greatest(lobby_games_28d - lobby_games_7d, 0) / 3.0 + 5)
        ))::integer
      ELSE 0
    END) STORED;

-- How many users have favorited each map, kept up to date by triggers on `favorited_maps`. Maps
-- without a row have no favorites.
CREATE TABLE map_favorite_counts (
  map_id uuid PRIMARY KEY REFERENCES maps (id) ON DELETE CASCADE,
  favorites integer NOT NULL CHECK (favorites >= 0)
);

-- Statement-level, so bulk changes to `favorited_maps` update each map's count once. Inserts that
-- don't add a row (e.g. ON CONFLICT DO NOTHING) don't appear in the transition tables.
CREATE FUNCTION update_map_favorite_counts() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'UPDATE' THEN
    UPDATE map_favorite_counts c
    SET favorites = c.favorites - r.removed
    FROM (SELECT map_id, count(*) AS removed FROM removed_favorites GROUP BY map_id) r
    WHERE c.map_id = r.map_id;
  END IF;

  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    INSERT INTO map_favorite_counts AS c (map_id, favorites)
    SELECT map_id, count(*) FROM added_favorites GROUP BY map_id
    ON CONFLICT (map_id) DO UPDATE SET favorites = c.favorites + EXCLUDED.favorites;
  END IF;

  IF TG_OP = 'TRUNCATE' THEN
    DELETE FROM map_favorite_counts;
  END IF;

  RETURN NULL;
END;
$$;

CREATE TRIGGER map_favorite_counts_insert
  AFTER INSERT ON favorited_maps
  REFERENCING NEW TABLE AS added_favorites
  FOR EACH STATEMENT EXECUTE FUNCTION update_map_favorite_counts();

CREATE TRIGGER map_favorite_counts_delete
  AFTER DELETE ON favorited_maps
  REFERENCING OLD TABLE AS removed_favorites
  FOR EACH STATEMENT EXECUTE FUNCTION update_map_favorite_counts();

CREATE TRIGGER map_favorite_counts_update
  AFTER UPDATE ON favorited_maps
  REFERENCING OLD TABLE AS removed_favorites NEW TABLE AS added_favorites
  FOR EACH STATEMENT EXECUTE FUNCTION update_map_favorite_counts();

CREATE TRIGGER map_favorite_counts_truncate
  AFTER TRUNCATE ON favorited_maps
  FOR EACH STATEMENT EXECUTE FUNCTION update_map_favorite_counts();

INSERT INTO map_favorite_counts (map_id, favorites)
SELECT map_id, count(*) FROM favorited_maps GROUP BY map_id;

-- Existing values were written as UTC. Rows without a date keep NULL; readers order them last.
ALTER TABLE favorited_maps
  ALTER COLUMN favorited_date TYPE timestamptz USING favorited_date AT TIME ZONE 'UTC';
