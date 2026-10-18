# Migrations

Applied with sqlx (`pnpm run migrate:run`). Create new ones with:

```bash
pnpm run migrate:create <name>
```

Don't write a migration file by hand. The version prefix is the creation time to the second, which
keeps migrations from parallel branches from colliding. Hand-picked round times
(`YYYYMMDD120000`) collide whenever two branches pick the same day.

sqlx applies any migration it hasn't seen yet regardless of order, so a branch's older-versioned
migration landing after newer ones is fine. A fresh database applies them in version order, though:
if a branch migration depends on a newer migration from master, re-create it with a newer version
when rebasing.

Never edit or rename a migration that has been merged. sqlx checksums applied migrations and refuses
to run when one changes.
