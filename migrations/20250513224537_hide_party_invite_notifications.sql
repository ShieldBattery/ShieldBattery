-- Hide all party invite notifications since they aren't a thing any more
-- Set them to read and visible = false
UPDATE notifications
SET
  read = true,
  visible = false
WHERE data->>'type' = 'partyInvite';
