# Training bot release visibility

The production catalog publisher includes only releases explicitly marked
`releaseStatus: "production-approved"`. Production clients use the fixed
production catalog URL, channel, and signing key. Catalog URL, channel, and
signing-key overrides are development-only. Catalog signatures and package
integrity checks apply to every installation.

Development builds retain access to staging releases and local builds. Cards,
bot details, and candidate updates show development-only status badges; production
builds omit those badges. Local builds remain development-only.

`releaseStatus` belongs to the signed catalog release, outside the immutable
package descriptor. Allowed values are `candidate`, `staging`, and
`production-approved`; missing status means `candidate`. Source-review approval,
distribution permission, and a verified game format do not imply production
approval. Maintainers review the exact release's advertised races, formats,
installation, lifecycle, and saved-state evidence before approving publication.
The publisher rejects signing or uploading a production catalog containing
unapproved releases.

The client displays the catalog it verifies without a second approval filter.
Installed releases remain visible, playable, and removable without a cached
catalog or when their entries disappear from a later catalog revision. This also
preserves access to installed packages and learning data. Catalog removal is not
a client revocation mechanism; revocation would need its own unavailable state
and uninstall flow.

Deploy the robotics-facility schema/publisher support alongside this client
change. This policy does not approve any current bot release.
