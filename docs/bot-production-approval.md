# Training bot release visibility

Production builds expose only catalog releases with
`releaseStatus: "production-approved"`. Development builds retain all catalog
releases and local builds. Cards and bot details label every other release
**Dev only — hidden in production**. Candidate updates are also labelled.

`releaseStatus` belongs to the signed catalog release, outside the immutable
package descriptor. Allowed values are `candidate`, `staging`, and
`production-approved`; missing status means `candidate`. Source-review approval,
distribution permission, and a verified game format do not imply production
approval. Maintainers must review the exact release's advertised races, formats,
installation, lifecycle and saved-state evidence before approving it in
robotics-facility and publishing a new staging catalog revision.

The main process filters snapshots and checks install and launch requests. A
previous installation or catalog URL/channel override cannot grant approval. An
installed release must match an approved release ID and archive digest in the
current catalog. Cached signed catalogs work offline; an absent, removed, or
unapproved catalog entry cannot authorize an installation. Hidden package files
and learning data remain on disk.

Production selects the latest approved catalog release, even when staging has a
newer candidate. Local builds remain available only in development. Publication
also filters unapproved releases before production promotion and rejects signing
or upload of a prepared production catalog containing them.

Deploy the robotics-facility schema/publisher support alongside this client
change. Existing releases without explicit approval become development-only;
this policy change does not approve any current bot.
