-- Runtime-tunable matchmaker configuration, read by server-rs at startup (and, once the admin
-- mutation lands, re-read when it changes). A single row (id = 1) holds the config as JSONB
-- containing only the *overrides* an admin has set; any field not present falls back to the
-- hardcoded defaults in server-rs. So an empty `{}` config — or a missing/unparseable row — means
-- "use the built-in defaults", and matchmaking can never be bricked by a bad or absent config.
--
-- Shape (all fields optional):
--   {
--     "searchIntervalSeconds": <number>,
--     "maxPlayersExamined": <number>,
--     "global": { <per-mode knob overrides> },
--     "perMode": { "<matchmaking_type>": { <per-mode knob overrides> } }
--   }
-- where a per-mode knob block is a subset of:
--   weightRatingVariance, weightWinProb, weightLatency, uncertaintyK, minQuality,
--   adaptiveComfortableMultiplier, adaptiveDecayPerMissing, populationHalfLifeSeconds
CREATE TABLE matchmaking_config (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by integer REFERENCES users (id) ON DELETE SET NULL
);

-- Seed the singleton "all defaults" row so the server always has a row to read and the admin
-- mutation always has a row to update.
INSERT INTO matchmaking_config (id, config) VALUES (1, '{}'::jsonb);
