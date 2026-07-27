-- Permission gating the live-stream moderation tools: the GraphQL query/mutations that list and
-- block/unblock the Twitch streams shown in the home-page live-streams feed. Separate from the other
-- moderation permissions because deciding which streams surface on the home page is its own
-- responsibility.
ALTER TABLE permissions ADD COLUMN manage_live_streams boolean NOT NULL DEFAULT false;
