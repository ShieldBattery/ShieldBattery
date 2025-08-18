-- Add columns to users table
ALTER TABLE users ADD COLUMN last_name_change TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN name_change_tokens INTEGER DEFAULT 0 NOT NULL;

-- Create audit table
CREATE TABLE user_display_name_audit (
    id uuid DEFAULT sb_uuid() NOT NULL PRIMARY KEY,
    user_id integer NOT NULL,
    old_name citext NOT NULL,
    new_name citext NOT NULL,
    changed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    changed_by_user_id integer, -- NULL if changed by user themselves
    change_reason text, -- Optional reason provided during change
    ip_address inet,
    user_agent text,
    session_id uuid, -- Link to user session if available
    used_token boolean NOT NULL DEFAULT FALSE,

    -- Foreign key constraints
    CONSTRAINT fk_user_display_name_audit_user_id
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_user_display_name_audit_changed_by
        FOREIGN KEY (changed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Performance indexes
CREATE INDEX idx_user_display_name_audit_user_id ON user_display_name_audit(user_id);
CREATE INDEX idx_user_display_name_audit_changed_at ON user_display_name_audit(changed_at DESC);
CREATE INDEX idx_user_display_name_audit_old_name ON user_display_name_audit(old_name);
CREATE INDEX idx_user_display_name_audit_new_name ON user_display_name_audit(new_name);

-- Function to handle display name audit logging
CREATE OR REPLACE FUNCTION log_display_name_change()
RETURNS TRIGGER AS $$
BEGIN
    -- Only log if name actually changed
    IF OLD.name IS DISTINCT FROM NEW.name THEN
        INSERT INTO user_display_name_audit (
            user_id,
            old_name,
            new_name,
            changed_at,
            changed_by_user_id,
            change_reason,
            ip_address,
            user_agent,
            session_id,
            used_token
        ) VALUES (
            NEW.id,
            OLD.name,
            NEW.name,
            CURRENT_TIMESTAMP,
            CASE WHEN current_setting('app.current_user_id', true) = '' THEN NULL
                 ELSE current_setting('app.current_user_id', true)::integer END,
            CASE WHEN current_setting('app.change_reason', true) = '' THEN NULL
                 ELSE current_setting('app.change_reason', true) END,
            CASE WHEN current_setting('app.client_ip', true) = '' THEN NULL
                 ELSE current_setting('app.client_ip', true)::inet END,
            CASE WHEN current_setting('app.user_agent', true) = '' THEN NULL
                 ELSE current_setting('app.user_agent', true) END,
            CASE WHEN current_setting('app.session_id', true) = '' THEN NULL
                 ELSE current_setting('app.session_id', true)::uuid END,
            OLD.name_change_tokens > NEW.name_change_tokens
        );
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
CREATE TRIGGER trigger_log_display_name_change
    AFTER UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION log_display_name_change();
