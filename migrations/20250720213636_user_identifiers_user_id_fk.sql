ALTER TABLE user_identifiers
ADD CONSTRAINT user_identifiers_user_id_fk
FOREIGN KEY (user_id)
REFERENCES users(id)
ON DELETE CASCADE;
