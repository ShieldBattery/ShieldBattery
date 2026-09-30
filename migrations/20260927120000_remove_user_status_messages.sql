ALTER TABLE account_settings
  ADD CONSTRAINT account_settings_no_status_message
  CHECK (NOT (settings ? 'statusMessage')) NOT VALID;

UPDATE account_settings
SET settings = settings - 'statusMessage'
WHERE settings ? 'statusMessage';

ALTER TABLE account_settings
  VALIDATE CONSTRAINT account_settings_no_status_message;
