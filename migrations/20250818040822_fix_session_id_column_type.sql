-- Fix session_id column types from uuid to text in both audit tables
-- and update login name audit trigger to include session_id

-- Drop existing triggers to avoid conflicts during column changes
DROP TRIGGER IF EXISTS trigger_log_display_name_change ON users;
DROP TRIGGER IF EXISTS trigger_log_login_name_change ON users;

-- Fix session_id column type in user_display_name_audit table
ALTER TABLE user_display_name_audit 
    ALTER COLUMN session_id TYPE text USING session_id::text;

-- Fix session_id column type in user_login_name_audit table
ALTER TABLE user_login_name_audit 
    ALTER COLUMN session_id TYPE text USING session_id::text;

-- Update the display name audit function to handle text session_id
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
                 ELSE current_setting('app.session_id', true) END,
            OLD.name_change_tokens > NEW.name_change_tokens
        );
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Update the login name audit function to include session_id support
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
            changed_by_user_id,
            change_reason,
            ip_address,
            user_agent,
            session_id
        ) VALUES (
            NEW.id,
            OLD.login_name,
            NEW.login_name,
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
                 ELSE current_setting('app.session_id', true) END
        );
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Recreate the triggers
CREATE TRIGGER trigger_log_display_name_change
    AFTER UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION log_display_name_change();

CREATE TRIGGER trigger_log_login_name_change
    AFTER UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION log_login_name_change();
