// These namespaces must remain distinct: reconciliation holds a session lock while moderation
// takes a transaction lock through another pooled connection.
export const IDENTIFIER_RECONCILIATION_LOCK = 17328512
export const IDENTIFIER_MODERATION_LOCK = 17328513

// Receipt admission must remain available while reconciliation processes another revision.
export const IDENTIFIER_OBSERVATION_LOCK = 17328514
