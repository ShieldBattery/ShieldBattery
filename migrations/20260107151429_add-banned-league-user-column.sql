-- Add column to track banned league users
ALTER TABLE league_users ADD COLUMN is_banned boolean NOT NULL DEFAULT false;
