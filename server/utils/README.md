# utils

Utility scripts meant to be used alongside the server (either during development or when deployed),
e.g. things for sending logs to the database, creating test accounts, etc.

If something is only meant to be using during development/testing, make sure to explicitly check
that `NODE_ENV` is not `'production'`.
