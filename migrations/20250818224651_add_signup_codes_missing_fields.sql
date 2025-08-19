-- Add notes column to user_signup_codes
ALTER TABLE user_signup_codes
ADD COLUMN notes TEXT;

-- Add signup code tracking to users
ALTER TABLE users
ADD COLUMN signup_code_used UUID REFERENCES user_signup_codes(id) ON DELETE SET NULL;

CREATE INDEX users_signup_code_used_idx ON users(signup_code_used);