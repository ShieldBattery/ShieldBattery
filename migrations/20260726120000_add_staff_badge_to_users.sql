-- Marks an account as speaking for the platform, which clients render as a badge next to the
-- user's name. This is granted by hand and is deliberately independent of the permissions system:
-- an account can hold moderation permissions without the badge, or the badge without any
-- permissions.
ALTER TABLE users
  ADD COLUMN staff_badge BOOLEAN NOT NULL DEFAULT FALSE;
