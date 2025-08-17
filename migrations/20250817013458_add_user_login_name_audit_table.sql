-- Create audit table for login name changes
CREATE TABLE user_login_name_audit (
    id uuid DEFAULT sb_uuid() NOT NULL PRIMARY KEY,
    user_id integer NOT NULL,
    old_login_name citext NOT NULL,
    new_login_name citext NOT NULL,
    changed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    changed_by_user_id integer, -- NULL if changed by user themselves
    change_reason text, -- Optional reason provided during change
    ip_address inet,
    user_agent text,
    session_id uuid, -- Link to user session if available

    -- Foreign key constraints
    CONSTRAINT fk_user_login_name_audit_user_id
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_user_login_name_audit_changed_by
        FOREIGN KEY (changed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Performance indexes
CREATE INDEX idx_user_login_name_audit_user_id ON user_login_name_audit(user_id);
CREATE INDEX idx_user_login_name_audit_changed_at ON user_login_name_audit(changed_at DESC);
CREATE INDEX idx_user_login_name_audit_old_login_name ON user_login_name_audit(old_login_name);
CREATE INDEX idx_user_login_name_audit_new_login_name ON user_login_name_audit(new_login_name);

-- Function to handle login name audit logging
CREATE OR REPLACE FUNCTION log_login_name_change()
RETURNS TRIGGER AS $$
BEGIN
    -- Only log if login_name actually changed
    IF OLD.login_name IS DISTINCT FROM NEW.login_name THEN
        INSERT INTO user_login_name_audit (
            user_id,
            old_login_name,
            new_login_name,
            changed_at,
            -- Note: changed_by_user_id, ip_address, user_agent would need to be
            -- set via application context or session variables
            changed_by_user_id,
            ip_address,
            user_agent
        ) VALUES (
            NEW.id,
            OLD.login_name,
            NEW.login_name,
            CURRENT_TIMESTAMP,
            -- These would be set via application context:
            CASE WHEN current_setting('app.current_user_id', true) = '' THEN NULL 
                 ELSE current_setting('app.current_user_id', true)::integer END,
            CASE WHEN current_setting('app.client_ip', true) = '' THEN NULL
                 ELSE current_setting('app.client_ip', true)::inet END,
            CASE WHEN current_setting('app.user_agent', true) = '' THEN NULL
                 ELSE current_setting('app.user_agent', true) END
        );
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
CREATE TRIGGER trigger_log_login_name_change
    AFTER UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION log_login_name_change();
