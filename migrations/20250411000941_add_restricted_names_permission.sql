ALTER TABLE permissions
ADD COLUMN manage_restricted_names BOOLEAN NOT NULL DEFAULT FALSE;
