-- Stores the file-store path (not URL) of a user's uploaded profile avatar. NULL means the user
-- has no custom avatar and clients should fall back to the generated placeholder. The path is
-- turned into a public URL at the API/GraphQL boundary (see convertToExternal in the node server
-- and the avatar_url resolvers in server-rs).
ALTER TABLE users
  ADD COLUMN avatar_path text;
