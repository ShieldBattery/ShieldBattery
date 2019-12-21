// Initially, we only had a unique constraint on the `map_hash` and `uploaded_by` columns, which
// meant that if the map was already uploaded by the same user with a different visibility, we
// couldn't upload it again (eg. an admin uploading an official map couldn't upload the same map as
// a private one). This was done because we've used a combination of these two columns as a primary
// key, and adding a third column to the PK would make the APIs that work with the maps
// unnecessarily complicated. However, for that and other reasons, we recently switched to adding a
// dedicated `id` column which we're now using as a primary key for the uploaded maps, which in turn
// makes it easier for us to support the use-case of the same user uploading a same map with
// different visibilities.
exports.up = async function(db) {
  await db.runSql(`
    ALTER TABLE uploaded_maps
    DROP CONSTRAINT uploaded_maps_map_hash_uploaded_by_key,
    ADD UNIQUE (map_hash, uploaded_by, visibility);
  `)
}

exports.down = async function(db) {
  await db.runSql(`
    ALTER TABLE uploaded_maps
    DROP CONSTRAINT uploaded_maps_map_hash_uploaded_by_visibility_key,
    ADD UNIQUE (map_hash, uploaded_by);
  `)
}

exports._meta = {
  version: 1,
}
