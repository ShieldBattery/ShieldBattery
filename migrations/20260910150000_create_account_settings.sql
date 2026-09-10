-- Settings that belong to the account rather than the machine (see `AccountSettings` in
-- common/settings/account-settings.ts), so they follow the user across installs. Only the keys the
-- user has changed are stored; the server merges them over the code-side defaults on every read,
-- which lets a new setting ship without touching existing rows. Machine-specific settings (install
-- paths, audio devices, window geometry, launch options) stay in the Electron app's local settings
-- file and never land here.
CREATE TABLE account_settings (
  user_id integer PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  settings jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
