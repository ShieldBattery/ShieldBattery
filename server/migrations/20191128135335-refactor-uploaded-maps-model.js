// This migration changes a couple of things in the `uploaded_maps` table:
//   1) Adds an `id` column that will serve as a PK, instead of using a combined PK of `map_hash` +
//      `uploaded_by` columns. This is done to simplify all the APIs that work with `uploaded_maps`,
//      allowing them to only send one value (an `id`) instead of two values (`map_hash` and
//      `uploaded_by`). `map_hash` and `uploaded_by` columns will still remain as foreign keys to
//      their respective tables.
//   2) Adds the `name` and `description` columns that will be editable by users. Since multiple
//      users can upload the same map, we have to save `name` and `description` of a map in this
//      table since they can give different values to those columns. Note that we're still keeping
//      the original `name` and `description` that we get from parsing the map in the `maps` table,
//      but I reckon we won't really use that information anywhere.
// Also, a few other tables that previously relied on old structure of map models have been updated
// to the newer version.
exports.up = async function (db) {
  await db.runSql(`
    ALTER TABLE uploaded_maps
    DROP CONSTRAINT uploaded_maps_pkey;
  `)

  await db.runSql(`
    ALTER TABLE uploaded_maps
    ADD COLUMN id uuid,
    ADD COLUMN name text,
    ADD COLUMN description text;
  `)

  await db.runSql(`
    UPDATE uploaded_maps
    SET id = uuid_generate_v4(), name = maps.title, description = maps.description
    FROM maps
    WHERE maps.hash = uploaded_maps.map_hash;
  `)

  await db.runSql(`
    ALTER TABLE uploaded_maps
    ADD PRIMARY KEY (id),
    ADD UNIQUE (map_hash, uploaded_by),
    ALTER COLUMN id SET NOT NULL,
    ALTER COLUMN name SET NOT NULL,
    ALTER COLUMN description SET NOT NULL;
  `)

  await db.runSql(`
    ALTER TABLE lobby_preferences
    DROP COLUMN recent_maps,
    DROP COLUMN selected_map,
    ADD COLUMN recent_maps uuid[],
    ADD COLUMN selected_map uuid;
  `)

  await db.runSql(`
    ALTER TABLE matchmaking_map_pools
    DROP COLUMN maps,
    ADD COLUMN maps uuid[];
  `)

  await db.runSql(`
    ALTER TABLE matchmaking_preferences
    DROP COLUMN preferred_maps,
    ADD COLUMN preferred_maps uuid[];
  `)
}

exports.down = async function (db) {
  await db.runSql(`
    ALTER TABLE uploaded_maps
    DROP CONSTRAINT uploaded_maps_pkey,
    DROP CONSTRAINT uploaded_maps_map_hash_uploaded_by_key;
  `)

  await db.runSql(`
    ALTER TABLE uploaded_maps
    DROP COLUMN id,
    DROP COLUMN name,
    DROP COLUMN description;
  `)

  await db.runSql(`
    ALTER TABLE uploaded_maps
    ADD PRIMARY KEY (uploaded_by, map_hash);
  `)

  await db.runSql(`
    ALTER TABLE lobby_preferences
    DROP COLUMN recent_maps,
    DROP COLUMN selected_map,
    ADD COLUMN recent_maps bytea[],
    ADD COLUMN selected_map bytea;
  `)

  await db.runSql(`
    ALTER TABLE matchmaking_map_pools
    DROP COLUMN maps,
    ADD COLUMN maps bytea[];
  `)

  await db.runSql(`
    ALTER TABLE matchmaking_preferences
    DROP COLUMN preferred_maps,
    ADD COLUMN preferred_maps bytea[];
  `)
}

exports._meta = {
  version: 1,
}
