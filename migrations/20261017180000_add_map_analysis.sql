ALTER TABLE maps
  -- Start-location units placed for player slots 0-7, as `[{"slot", "x", "y"}]` in map pixels, one
  -- per slot (the last placed wins, as in game). Empty until the file is parsed by parser version
  -- 3 or later.
  ADD COLUMN start_locations jsonb NOT NULL DEFAULT '[]',
  -- Whether the map has UMS content: a trigger action outside the melee-compatible set, more than
  -- 8 preplaced player-owned units, or EUDs. NULL until the file is parsed by parser version 3 or
  -- later.
  ADD COLUMN ums_content boolean,
  -- The last parser version that failed to parse this file, and why. A file isn't retried until
  -- the parser version changes again.
  ADD COLUMN parse_failed_version integer,
  ADD COLUMN parse_error text;

-- A map is UMS if it has UMS content or can't seat two players in melee. Rows that haven't been
-- parsed for UMS content yet fall back to the slot layout: a computer slot or a fixed race.
ALTER TABLE maps
  ALTER COLUMN kind SET EXPRESSION AS
    (CASE
      WHEN players_melee < 2 OR is_eud OR COALESCE(ums_content, jsonb_path_exists(lobby_init_data,
        '$.forces[*].players[*] ? (@.computer == true || @.race != "any")'))
      THEN 'ums'
      ELSE 'melee'
    END),
  ALTER COLUMN player_count SET EXPRESSION AS
    (CASE
      WHEN players_melee < 2 OR is_eud OR COALESCE(ums_content, jsonb_path_exists(lobby_init_data,
        '$.forces[*].players[*] ? (@.computer == true || @.race != "any")'))
      THEN CASE WHEN players_ums > 0 THEN players_ums ELSE players_melee END
      ELSE CASE WHEN players_melee > 0 THEN players_melee ELSE players_ums END
    END);

-- What the parser found in a map file beyond what lobbies and games need. Written together with
-- `maps.parser_version`; read by map pages, jobs and moderation.
CREATE TABLE map_analysis (
  map_id uuid PRIMARY KEY REFERENCES maps (id) ON DELETE CASCADE,
  -- The CHK format version (`VER `), e.g. 205 for SC:R maps.
  format_version integer NOT NULL,
  -- How the map's strings were decoded: `utf8`, `cp949` or `cp1252`.
  string_encoding text NOT NULL,
  trigger_count integer NOT NULL,
  briefing_count integer NOT NULL,
  -- The trigger action kinds outside the melee-compatible set, which make `ums_content` true.
  ums_action_kinds text[] NOT NULL,
  -- Preplaced units, excluding start locations, and the ones owned by player slots 0-7.
  placed_units integer NOT NULL,
  player_units integer NOT NULL,
  mineral_fields integer NOT NULL,
  mineral_total bigint NOT NULL,
  geysers integer NOT NULL,
  -- Resource bases, as `[{"x", "y", "mineralFields", "minerals", "geysers", "startSlots"}]`, with
  -- the town hall position in pixels. NULL when base discovery couldn't run (the reason is in
  -- `anomalies`).
  bases jsonb,
  -- "Made by X"-style credits found in the title and description. A hint for staff and
  -- publishers, never shown as a credit.
  author_suggestions text[] NOT NULL,
  -- Signs of a map protector or a damaged file, e.g. `duplicate_chk_entries`. Most are also found
  -- in unprotected maps; `protection_detected` is set only by the strong ones.
  anomalies text[] NOT NULL,
  protection_detected boolean NOT NULL,
  -- The terrain shape, 2 bits per build tile (unwalkable, or the majority elevation of its
  -- walkable cells), row-major. Used to find versions and copies of a map. NULL when the terrain
  -- couldn't be resolved.
  terrain_fingerprint bytea,
  fingerprint_version smallint
);

-- Uploads the parser rejected. The file is kept in the file store under `map_rejects/` so a
-- parser regression can be reproduced, and both are deleted after 30 days.
CREATE TABLE map_parse_rejections (
  hash bytea PRIMARY KEY,
  extension character(3) NOT NULL,
  error text NOT NULL,
  uploaded_by integer NOT NULL REFERENCES users (id),
  rejected_at timestamptz NOT NULL
);

CREATE INDEX map_parse_rejections_rejected_at_index ON map_parse_rejections (rejected_at);
