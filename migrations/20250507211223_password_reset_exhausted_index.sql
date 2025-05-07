CREATE INDEX password_resets_exhausted_false ON password_resets (exhausted) WHERE exhausted = false;
