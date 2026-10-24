-- A family whose derived lines may be out of date because something outside a family write changed
-- what they're derived from: a member was listed or delisted, or deleted. Server-rs recomputes
-- stale families.
ALTER TABLE map_families ADD COLUMN stale boolean NOT NULL DEFAULT false;

CREATE INDEX map_families_stale_index ON map_families (id) WHERE stale;

CREATE FUNCTION mark_map_family_stale() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  UPDATE map_families
  SET stale = true
  WHERE id = (SELECT family_id FROM map_family_members WHERE map_id = OLD.id);
  RETURN NULL;
END;
$$;

CREATE TRIGGER maps_listed_marks_family_stale
  AFTER UPDATE OF published_at, delisted_at ON maps
  FOR EACH ROW
  WHEN (OLD.listed IS DISTINCT FROM NEW.listed)
  EXECUTE FUNCTION mark_map_family_stale();

CREATE FUNCTION mark_map_family_stale_on_member_delete() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  UPDATE map_families SET stale = true WHERE id = OLD.family_id;
  RETURN NULL;
END;
$$;

CREATE TRIGGER map_family_members_delete_marks_family_stale
  AFTER DELETE ON map_family_members
  FOR EACH ROW
  EXECUTE FUNCTION mark_map_family_stale_on_member_delete();

-- Users telling staff a map is in the wrong family, or is related to another map. Reports change
-- nothing by themselves; staff resolve them from the families queue.
CREATE TABLE map_family_reports (
  id uuid PRIMARY KEY DEFAULT sb_uuid(),
  map_id uuid NOT NULL REFERENCES maps (id) ON DELETE CASCADE,
  -- The map the reporter says this one is related to. Only for `related`.
  other_map_id uuid REFERENCES maps (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('wrong_family', 'related')),
  -- How the reporter says `map_id` relates to `other_map_id`, e.g. `version` when it's a newer
  -- version of it.
  suggested_relation map_family_relation,
  note text,
  reported_by integer NOT NULL REFERENCES users (id),
  reported_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  resolved_by integer REFERENCES users (id),
  resolved_at timestamptz,
  CHECK ((kind = 'related') = (other_map_id IS NOT NULL)),
  CHECK (other_map_id IS DISTINCT FROM map_id)
);

CREATE INDEX map_family_reports_open_index ON map_family_reports (reported_at)
  WHERE status = 'open';
CREATE INDEX map_family_reports_map_id_index ON map_family_reports (map_id);
CREATE INDEX map_family_reports_other_map_id_index ON map_family_reports (other_map_id);
-- One open report per reporter, map and other map, so repeating a report doesn't pile up rows.
CREATE UNIQUE INDEX map_family_reports_open_unique_index
  ON map_family_reports (reported_by, map_id, COALESCE(other_map_id, map_id))
  WHERE status = 'open';

-- Play statistics summed over every file in a family line (a map's versions, variants and
-- translations, without its forks), the same columns as `map_stats`. Rebuilt with `map_stats`, and
-- only for lines with more than one file: other maps read their own `map_stats` row.
CREATE TABLE map_line_stats (
  line_root_id uuid PRIMARY KEY REFERENCES maps (id) ON DELETE CASCADE,
  games_7d integer NOT NULL,
  games_28d integer NOT NULL,
  games_90d integer NOT NULL,
  players_90d integer NOT NULL,
  games_total integer NOT NULL,
  median_length_90d integer,
  last_played_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  lobby_games_7d integer NOT NULL,
  lobby_games_28d integer NOT NULL,
  lobby_players_7d integer NOT NULL,
  -- The same formula as `map_stats.trending_score`.
  trending_score integer NOT NULL GENERATED ALWAYS AS
    (CASE
      WHEN lobby_players_7d >= 5 THEN
        greatest(0, round(
          100 * (lobby_games_7d - greatest(lobby_games_28d - lobby_games_7d, 0) / 3.0) /
            sqrt(greatest(lobby_games_28d - lobby_games_7d, 0) / 3.0 + 5)
        ))::integer
      ELSE 0
    END) STORED,
  -- Distinct users who favorited any file in the line.
  favorites integer NOT NULL
);
