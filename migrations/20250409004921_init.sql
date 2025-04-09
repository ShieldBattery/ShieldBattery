-- This migration is the first one in sqlx, but we used to use node-db-migrate. We assume if
-- anything in the schema already exists, that node-db-migrate initialized this DB, so we bail out
-- and tell sqlx this migration is completed. Otherwise, we initialize the db as normal. If you have
-- an older DB and don't have all the node-db-migrate migrations, either check out the last commit
-- that still had them and run them, or drop your development DB and recreate it fresh.

-- Create a temp table to track schema existence
CREATE TEMPORARY TABLE _schema_check(exists_already boolean);

-- Check if schema already exists
INSERT INTO _schema_check (exists_already)
SELECT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'game_result');

-- Only proceed with schema creation if it doesn't already exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _schema_check WHERE exists_already = true) THEN
    -- PostgreSQL database dump

    -- Dumped from database version 17.4 (Debian 17.4-1.pgdg120+2)
    -- Dumped by pg_dump version 17.4 (Debian 17.4-1.pgdg120+2)

    --
    -- Name: game_result; Type: TYPE; Schema: public; Owner: shieldbattery
    --

    CREATE TYPE public.game_result AS ENUM (
        'unknown',
        'draw',
        'loss',
        'win'
    );


    ALTER TYPE public.game_result OWNER TO shieldbattery;

    --
    -- Name: game_type; Type: TYPE; Schema: public; Owner: shieldbattery
    --

    CREATE TYPE public.game_type AS ENUM (
        'melee',
        'ffa',
        'topVBottom',
        'teamMelee',
        'teamFfa',
        'ums',
        'oneVOne'
    );


    ALTER TYPE public.game_type OWNER TO shieldbattery;

    --
    -- Name: map_visibility; Type: TYPE; Schema: public; Owner: shieldbattery
    --

    CREATE TYPE public.map_visibility AS ENUM (
        'OFFICIAL',
        'PRIVATE',
        'PUBLIC'
    );


    ALTER TYPE public.map_visibility OWNER TO shieldbattery;

    --
    -- Name: matchmaking_completion_type; Type: TYPE; Schema: public; Owner: shieldbattery
    --

    CREATE TYPE public.matchmaking_completion_type AS ENUM (
        'found',
        'cancel',
        'disconnect'
    );


    ALTER TYPE public.matchmaking_completion_type OWNER TO shieldbattery;

    --
    -- Name: matchmaking_result; Type: TYPE; Schema: public; Owner: shieldbattery
    --

    CREATE TYPE public.matchmaking_result AS ENUM (
        'loss',
        'win'
    );


    ALTER TYPE public.matchmaking_result OWNER TO shieldbattery;

    --
    -- Name: matchmaking_type; Type: TYPE; Schema: public; Owner: shieldbattery
    --

    CREATE TYPE public.matchmaking_type AS ENUM (
        '1v1',
        '2v2',
        '1v1fastest'
    );


    ALTER TYPE public.matchmaking_type OWNER TO shieldbattery;

    --
    -- Name: race; Type: TYPE; Schema: public; Owner: shieldbattery
    --

    CREATE TYPE public.race AS ENUM (
        'z',
        't',
        'p',
        'r'
    );


    ALTER TYPE public.race OWNER TO shieldbattery;

    --
    -- Name: relationship_kind; Type: TYPE; Schema: public; Owner: shieldbattery
    --

    CREATE TYPE public.relationship_kind AS ENUM (
        'friend',
        'friend_request_low_to_high',
        'friend_request_high_to_low',
        'block_low_to_high',
        'block_high_to_low',
        'block_both'
    );


    ALTER TYPE public.relationship_kind OWNER TO shieldbattery;



    SET default_tablespace = '';

    SET default_table_access_method = heap;

    --
    -- Name: bug_reports; Type: TABLE; Schema: public; Owner: shieldbattery
    --

    CREATE TABLE public.bug_reports (
        id uuid DEFAULT public.sb_uuid() NOT NULL,
        submitter_id integer,
        details text NOT NULL,
        logs_deleted boolean DEFAULT false NOT NULL,
        created_at timestamp without time zone DEFAULT now() NOT NULL,
        resolved_at timestamp without time zone,
        resolver_id integer
    );


    ALTER TABLE public.bug_reports OWNER TO shieldbattery;

    --
    -- Name: channel_bans; Type: TABLE; Schema: public; Owner: shieldbattery
    --

    CREATE TABLE public.channel_bans (
        user_id integer NOT NULL,
        ban_time timestamp without time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
        banned_by integer,
        reason text,
        automated boolean DEFAULT false NOT NULL,
        channel_id integer NOT NULL
    );


    ALTER TABLE public.channel_bans OWNER TO shieldbattery;

    --
    -- Name: channel_identifier_bans; Type: TABLE; Schema: public; Owner: shieldbattery
    --

    CREATE TABLE public.channel_identifier_bans (
        identifier_type smallint NOT NULL,
        identifier_hash bytea NOT NULL,
        time_banned timestamp without time zone NOT NULL,
        first_user_id integer NOT NULL,
        channel_id integer NOT NULL
    );


    ALTER TABLE public.channel_identifier_bans OWNER TO shieldbattery;

    --
    -- Name: channel_messages; Type: TABLE; Schema: public; Owner: shieldbattery
    --

    CREATE TABLE public.channel_messages (
        id uuid DEFAULT public.sb_uuid() NOT NULL,
        user_id integer NOT NULL,
        sent timestamp without time zone NOT NULL,
        data jsonb NOT NULL,
        channel_id integer NOT NULL
    );


    ALTER TABLE public.channel_messages OWNER TO shieldbattery;

    --
    -- Name: channel_users; Type: TABLE; Schema: public; Owner: shieldbattery
    --

    CREATE TABLE public.channel_users (
        user_id integer NOT NULL,
        join_date timestamp without time zone NOT NULL,
        kick boolean DEFAULT false NOT NULL,
        ban boolean DEFAULT false NOT NULL,
        change_topic boolean DEFAULT false NOT NULL,
        toggle_private boolean DEFAULT false NOT NULL,
        edit_permissions boolean DEFAULT false NOT NULL,
        channel_id integer NOT NULL,
        hide_banner boolean DEFAULT false NOT NULL
    );


    ALTER TABLE public.channel_users OWNER TO shieldbattery;

    --
    -- Name: channels; Type: TABLE; Schema: public; Owner: shieldbattery
    --

    CREATE TABLE public.channels (
        name public.citext NOT NULL,
        private boolean DEFAULT false NOT NULL,
        official boolean DEFAULT false NOT NULL,
        topic text,
        owner_id integer,
        id integer NOT NULL,
        user_count integer DEFAULT 0 NOT NULL,
        description text,
        banner_path text,
        badge_path text,
        CONSTRAINT channel_name_length_check CHECK ((length((name)::text) <= 64))
    );


    ALTER TABLE public.channels OWNER TO shieldbattery;

    --
    -- Name: channels_id_seq; Type: SEQUENCE; Schema: public; Owner: shieldbattery
    --

    CREATE SEQUENCE public.channels_id_seq
        START WITH 1
        INCREMENT BY 1
        NO MINVALUE
        NO MAXVALUE
        CACHE 1;


    ALTER SEQUENCE public.channels_id_seq OWNER TO shieldbattery;

    --
    -- Name: channels_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: shieldbattery
    --

    ALTER SEQUENCE public.channels_id_seq OWNED BY public.channels.id;


    --
    -- Name: email_verifications; Type: TABLE; Schema: public; Owner: shieldbattery
    --

    CREATE TABLE public.email_verifications (
        user_id integer NOT NULL,
        email character varying(100) NOT NULL,
        verification_code character varying(50) NOT NULL,
        request_time timestamp without time zone NOT NULL,
        request_ip inet NOT NULL
    );


    ALTER TABLE public.email_verifications OWNER TO shieldbattery;

    --
    -- Name: favorited_maps; Type: TABLE; Schema: public; Owner: shieldbattery
    --

    CREATE TABLE public.favorited_maps (
        map_id uuid NOT NULL,
        favorited_by integer NOT NULL,
        favorited_date timestamp without time zone
    );


    ALTER TABLE public.favorited_maps OWNER TO shieldbattery;

    --
    -- Name: games; Type: TABLE; Schema: public; Owner: shieldbattery
    --

    CREATE TABLE public.games (
        id uuid DEFAULT public.sb_uuid() NOT NULL,
        start_time timestamp without time zone NOT NULL,
        map_id uuid NOT NULL,
        config jsonb NOT NULL,
        disputable boolean NOT NULL,
        dispute_requested boolean NOT NULL,
        dispute_reviewed boolean NOT NULL,
        game_length integer,
        results jsonb,
        routes jsonb[]
    );


    ALTER TABLE public.games OWNER TO shieldbattery;

    --
    -- Name: games_users; Type: TABLE; Schema: public; Owner: shieldbattery
    --

    CREATE TABLE public.games_users (
        user_id integer NOT NULL,
        game_id uuid NOT NULL,
        start_time timestamp without time zone NOT NULL,
        selected_race public.race NOT NULL,
        result_code character varying(50) NOT NULL,
        reported_results jsonb,
        reported_at timestamp without time zone,
        assigned_race public.race,
        result public.game_result,
        apm integer
    );


    ALTER TABLE public.games_users OWNER TO shieldbattery;

    --
    -- Name: league_user_changes; Type: TABLE; Schema: public; Owner: shieldbattery
    --

    CREATE TABLE public.league_user_changes (
        user_id integer NOT NULL,
        league_id uuid NOT NULL,
        game_id uuid NOT NULL,
        change_date timestamp without time zone NOT NULL,
        outcome public.matchmaking_result NOT NULL,
        points real NOT NULL,
        points_change real NOT NULL,
        points_converged boolean NOT NULL
    );


    ALTER TABLE public.league_user_changes OWNER TO shieldbattery;

    --
    -- Name: league_users; Type: TABLE; Schema: public; Owner: shieldbattery
    --

    CREATE TABLE public.league_users (
        league_id uuid NOT NULL,
        user_id integer NOT NULL,
        last_played_date timestamp without time zone,
        points real DEFAULT 0 NOT NULL,
        points_converged boolean DEFAULT false NOT NULL,
        wins integer DEFAULT 0 NOT NULL,
        losses integer DEFAULT 0 NOT NULL,
        p_wins integer DEFAULT 0 NOT NULL,
        p_losses integer DEFAULT 0 NOT NULL,
        t_wins integer DEFAULT 0 NOT NULL,
        t_losses integer DEFAULT 0 NOT NULL,
        z_wins integer DEFAULT 0 NOT NULL,
        z_losses integer DEFAULT 0 NOT NULL,
        r_wins integer DEFAULT 0 NOT NULL,
        r_losses integer DEFAULT 0 NOT NULL,
        r_p_wins integer DEFAULT 0 NOT NULL,
        r_p_losses integer DEFAULT 0 NOT NULL,
        r_t_wins integer DEFAULT 0 NOT NULL,
        r_t_losses integer DEFAULT 0 NOT NULL,
        r_z_wins integer DEFAULT 0 NOT NULL,
        r_z_losses integer DEFAULT 0 NOT NULL
    );


    ALTER TABLE public.league_users OWNER TO shieldbattery;

    --
    -- Name: leagues; Type: TABLE; Schema: public; Owner: shieldbattery
    --

    CREATE TABLE public.leagues (
        id uuid DEFAULT public.sb_uuid() NOT NULL,
        name text NOT NULL,
        description text NOT NULL,
        signups_after timestamp without time zone NOT NULL,
        start_at timestamp without time zone NOT NULL,
        end_at timestamp without time zone NOT NULL,
        image_path text,
        rules_and_info text,
        link text,
        matchmaking_type public.matchmaking_type NOT NULL,
        badge_path text,
        CONSTRAINT leagues_check CHECK ((signups_after <= start_at)),
        CONSTRAINT leagues_check1 CHECK ((start_at <= end_at))
    );


    ALTER TABLE public.leagues OWNER TO shieldbattery;

    --
    -- Name: lobby_preferences; Type: TABLE; Schema: public; Owner: shieldbattery
    --

    CREATE TABLE public.lobby_preferences (
        user_id integer NOT NULL,
        name character varying(50),
        game_type public.game_type,
        game_sub_type integer,
        recent_maps uuid[],
        selected_map uuid,
        turn_rate integer,
        use_legacy_limits boolean
    );


    ALTER TABLE public.lobby_preferences OWNER TO shieldbattery;

    --
    -- Name: maps; Type: TABLE; Schema: public; Owner: shieldbattery
    --

    CREATE TABLE public.maps (
        hash bytea NOT NULL,
        extension character(3) NOT NULL,
        title text NOT NULL,
        description text NOT NULL,
        width integer NOT NULL,
        height integer NOT NULL,
        tileset integer NOT NULL,
        players_melee integer NOT NULL,
        players_ums integer NOT NULL,
        lobby_init_data jsonb NOT NULL,
        is_eud boolean DEFAULT false NOT NULL,
        parser_version integer DEFAULT 1 NOT NULL,
        image_version integer DEFAULT 1 NOT NULL
    );


    ALTER TABLE public.maps OWNER TO shieldbattery;

    --
    -- Name: matchmaking_completions; Type: TABLE; Schema: public; Owner: shieldbattery
    --

    CREATE TABLE public.matchmaking_completions (
        id uuid DEFAULT public.sb_uuid() NOT NULL,
        user_id integer NOT NULL,
        matchmaking_type public.matchmaking_type NOT NULL,
        completion_type public.matchmaking_completion_type NOT NULL,
        search_time_millis integer NOT NULL,
        completion_time timestamp without time zone DEFAULT timezone('utc'::text, now()) NOT NULL
    );


    ALTER TABLE public.matchmaking_completions OWNER TO shieldbattery;

    --
    -- Name: matchmaking_finalized_ranks; Type: TABLE; Schema: public; Owner: shieldbattery
    --

    CREATE TABLE public.matchmaking_finalized_ranks (
        season_id integer NOT NULL,
        matchmaking_type public.matchmaking_type NOT NULL,
        user_id integer NOT NULL,
        rank integer NOT NULL
    );


    ALTER TABLE public.matchmaking_finalized_ranks OWNER TO shieldbattery;

    --
    -- Name: matchmaking_map_pools; Type: TABLE; Schema: public; Owner: shieldbattery
    --

    CREATE TABLE public.matchmaking_map_pools (
        id integer NOT NULL,
        matchmaking_type public.matchmaking_type NOT NULL,
        start_date timestamp without time zone NOT NULL,
        maps uuid[],
        max_veto_count integer DEFAULT 3 NOT NULL
    );


    ALTER TABLE public.matchmaking_map_pools OWNER TO shieldbattery;

    --
    -- Name: matchmaking_map_pools_id_seq; Type: SEQUENCE; Schema: public; Owner: shieldbattery
    --

    CREATE SEQUENCE public.matchmaking_map_pools_id_seq
        AS integer
        START WITH 1
        INCREMENT BY 1
        NO MINVALUE
        NO MAXVALUE
        CACHE 1;


    ALTER SEQUENCE public.matchmaking_map_pools_id_seq OWNER TO shieldbattery;

    --
    -- Name: matchmaking_map_pools_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: shieldbattery
    --

    ALTER SEQUENCE public.matchmaking_map_pools_id_seq OWNED BY public.matchmaking_map_pools.id;


    --
    -- Name: matchmaking_preferences; Type: TABLE; Schema: public; Owner: shieldbattery
    --

    CREATE TABLE public.matchmaking_preferences (
        user_id integer NOT NULL,
        matchmaking_type public.matchmaking_type NOT NULL,
        race public.race NOT NULL,
        map_pool_id integer NOT NULL,
        map_selections uuid[] NOT NULL,
        data jsonb NOT NULL
    );


    ALTER TABLE public.matchmaking_preferences OWNER TO shieldbattery;

    --
    -- Name: matchmaking_rating_changes; Type: TABLE; Schema: public; Owner: shieldbattery
    --

    CREATE TABLE public.matchmaking_rating_changes (
        user_id integer NOT NULL,
        matchmaking_type public.matchmaking_type NOT NULL,
        game_id uuid NOT NULL,
        change_date timestamp without time zone NOT NULL,
        outcome public.matchmaking_result NOT NULL,
        rating real NOT NULL,
        rating_change real NOT NULL,
        uncertainty real NOT NULL,
        uncertainty_change real NOT NULL,
        probability real NOT NULL,
        points real DEFAULT 0,
        points_change real DEFAULT 0,
        bonus_used real DEFAULT 0,
        bonus_used_change real DEFAULT 0,
        volatility real DEFAULT 0,
        volatility_change real DEFAULT 0,
        lifetime_games integer DEFAULT 0,
        points_converged boolean DEFAULT false
    );


    ALTER TABLE public.matchmaking_rating_changes OWNER TO shieldbattery;

    --
    -- Name: matchmaking_ratings; Type: TABLE; Schema: public; Owner: shieldbattery
    --

    CREATE TABLE public.matchmaking_ratings (
        user_id integer NOT NULL,
        matchmaking_type public.matchmaking_type NOT NULL,
        rating real NOT NULL,
        uncertainty real NOT NULL,
        num_games_played integer NOT NULL,
        last_played_date timestamp without time zone NOT NULL,
        wins integer DEFAULT 0,
        losses integer DEFAULT 0,
        p_wins integer DEFAULT 0 NOT NULL,
        p_losses integer DEFAULT 0 NOT NULL,
        t_wins integer DEFAULT 0 NOT NULL,
        t_losses integer DEFAULT 0 NOT NULL,
        z_wins integer DEFAULT 0 NOT NULL,
        z_losses integer DEFAULT 0 NOT NULL,
        r_wins integer DEFAULT 0 NOT NULL,
        r_losses integer DEFAULT 0 NOT NULL,
        r_p_wins integer DEFAULT 0 NOT NULL,
        r_p_losses integer DEFAULT 0 NOT NULL,
        r_t_wins integer DEFAULT 0 NOT NULL,
        r_t_losses integer DEFAULT 0 NOT NULL,
        r_z_wins integer DEFAULT 0 NOT NULL,
        r_z_losses integer DEFAULT 0 NOT NULL,
        season_id integer NOT NULL,
        points real DEFAULT 0,
        bonus_used real DEFAULT 0,
        volatility real DEFAULT 0,
        lifetime_games integer DEFAULT 0,
        points_converged boolean DEFAULT false
    );


    ALTER TABLE public.matchmaking_ratings OWNER TO shieldbattery;

    --
    -- Name: matchmaking_seasons; Type: TABLE; Schema: public; Owner: shieldbattery
    --

    CREATE TABLE public.matchmaking_seasons (
        id integer NOT NULL,
        start_date timestamp without time zone NOT NULL,
        name text NOT NULL,
        reset_mmr boolean DEFAULT false NOT NULL
    );


    ALTER TABLE public.matchmaking_seasons OWNER TO shieldbattery;

    --
    -- Name: matchmaking_seasons_id_seq; Type: SEQUENCE; Schema: public; Owner: shieldbattery
    --

    CREATE SEQUENCE public.matchmaking_seasons_id_seq
        AS integer
        START WITH 1
        INCREMENT BY 1
        NO MINVALUE
        NO MAXVALUE
        CACHE 1;


    ALTER SEQUENCE public.matchmaking_seasons_id_seq OWNER TO shieldbattery;

    --
    -- Name: matchmaking_seasons_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: shieldbattery
    --

    ALTER SEQUENCE public.matchmaking_seasons_id_seq OWNED BY public.matchmaking_seasons.id;


    --
    -- Name: matchmaking_times; Type: TABLE; Schema: public; Owner: shieldbattery
    --

    CREATE TABLE public.matchmaking_times (
        id integer NOT NULL,
        matchmaking_type public.matchmaking_type NOT NULL,
        start_date timestamp without time zone NOT NULL,
        enabled boolean NOT NULL
    );


    ALTER TABLE public.matchmaking_times OWNER TO shieldbattery;

    --
    -- Name: matchmaking_times_id_seq; Type: SEQUENCE; Schema: public; Owner: shieldbattery
    --

    CREATE SEQUENCE public.matchmaking_times_id_seq
        AS integer
        START WITH 1
        INCREMENT BY 1
        NO MINVALUE
        NO MAXVALUE
        CACHE 1;


    ALTER SEQUENCE public.matchmaking_times_id_seq OWNER TO shieldbattery;

    --
    -- Name: matchmaking_times_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: shieldbattery
    --

    ALTER SEQUENCE public.matchmaking_times_id_seq OWNED BY public.matchmaking_times.id;


    --
    -- Name: migrations; Type: TABLE; Schema: public; Owner: shieldbattery
    --

    CREATE TABLE public.migrations (
        id integer NOT NULL,
        name character varying(255) NOT NULL,
        run_on timestamp without time zone NOT NULL
    );


    ALTER TABLE public.migrations OWNER TO shieldbattery;

    --
    -- Name: migrations_id_seq; Type: SEQUENCE; Schema: public; Owner: shieldbattery
    --

    CREATE SEQUENCE public.migrations_id_seq
        AS integer
        START WITH 1
        INCREMENT BY 1
        NO MINVALUE
        NO MAXVALUE
        CACHE 1;


    ALTER SEQUENCE public.migrations_id_seq OWNER TO shieldbattery;

    --
    -- Name: migrations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: shieldbattery
    --

    ALTER SEQUENCE public.migrations_id_seq OWNED BY public.migrations.id;


    --
    -- Name: news_post_edits; Type: TABLE; Schema: public; Owner: shieldbattery
    --

    CREATE TABLE public.news_post_edits (
        id uuid DEFAULT public.sb_uuid() NOT NULL,
        post_id uuid NOT NULL,
        editor_id integer,
        author_id integer,
        cover_image_path text,
        title text NOT NULL,
        summary text NOT NULL,
        content text NOT NULL,
        published_at timestamp with time zone,
        edited_at timestamp with time zone DEFAULT now() NOT NULL
    );


    ALTER TABLE public.news_post_edits OWNER TO shieldbattery;

    --
    -- Name: news_posts; Type: TABLE; Schema: public; Owner: shieldbattery
    --

    CREATE TABLE public.news_posts (
        id uuid DEFAULT public.sb_uuid() NOT NULL,
        author_id integer,
        cover_image_path text,
        title text NOT NULL,
        summary text NOT NULL,
        content text NOT NULL,
        published_at timestamp with time zone,
        updated_at timestamp with time zone DEFAULT now() NOT NULL
    );


    ALTER TABLE public.news_posts OWNER TO shieldbattery;

    --
    -- Name: notifications; Type: TABLE; Schema: public; Owner: shieldbattery
    --

    CREATE TABLE public.notifications (
        id uuid DEFAULT public.sb_uuid() NOT NULL,
        user_id integer NOT NULL,
        data jsonb NOT NULL,
        read boolean DEFAULT false NOT NULL,
        visible boolean DEFAULT true NOT NULL,
        created_at timestamp without time zone NOT NULL
    );


    ALTER TABLE public.notifications OWNER TO shieldbattery;

    --
    -- Name: password_resets; Type: TABLE; Schema: public; Owner: shieldbattery
    --

    CREATE TABLE public.password_resets (
        user_id integer NOT NULL,
        reset_code character varying(50) NOT NULL,
        request_time timestamp without time zone NOT NULL,
        request_ip inet NOT NULL,
        used boolean NOT NULL
    );


    ALTER TABLE public.password_resets OWNER TO shieldbattery;

    --
    -- Name: permissions; Type: TABLE; Schema: public; Owner: shieldbattery
    --

    CREATE TABLE public.permissions (
        user_id integer NOT NULL,
        edit_permissions boolean DEFAULT false NOT NULL,
        debug boolean DEFAULT false NOT NULL,
        ban_users boolean DEFAULT false NOT NULL,
        manage_maps boolean DEFAULT false NOT NULL,
        manage_map_pools boolean DEFAULT false NOT NULL,
        mass_delete_maps boolean DEFAULT false NOT NULL,
        manage_matchmaking_times boolean DEFAULT false NOT NULL,
        manage_rally_point_servers boolean DEFAULT false NOT NULL,
        moderate_chat_channels boolean DEFAULT false NOT NULL,
        manage_matchmaking_seasons boolean DEFAULT false NOT NULL,
        manage_leagues boolean DEFAULT false NOT NULL,
        manage_news boolean DEFAULT false NOT NULL,
        manage_bug_reports boolean DEFAULT false NOT NULL
    );


    ALTER TABLE public.permissions OWNER TO shieldbattery;

    --
    -- Name: rally_point_servers; Type: TABLE; Schema: public; Owner: shieldbattery
    --

    CREATE TABLE public.rally_point_servers (
        id integer NOT NULL,
        enabled boolean NOT NULL,
        description character varying(64),
        hostname character varying(64),
        port smallint
    );


    ALTER TABLE public.rally_point_servers OWNER TO shieldbattery;

    --
    -- Name: rally_point_servers_id_seq; Type: SEQUENCE; Schema: public; Owner: shieldbattery
    --

    CREATE SEQUENCE public.rally_point_servers_id_seq
        AS integer
        START WITH 1
        INCREMENT BY 1
        NO MINVALUE
        NO MAXVALUE
        CACHE 1;


    ALTER SEQUENCE public.rally_point_servers_id_seq OWNER TO shieldbattery;

    --
    -- Name: rally_point_servers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: shieldbattery
    --

    ALTER SEQUENCE public.rally_point_servers_id_seq OWNED BY public.rally_point_servers.id;


    --
    -- Name: uploaded_maps; Type: TABLE; Schema: public; Owner: shieldbattery
    --

    CREATE TABLE public.uploaded_maps (
        map_hash bytea NOT NULL,
        uploaded_by integer NOT NULL,
        upload_date timestamp without time zone NOT NULL,
        visibility public.map_visibility DEFAULT 'PRIVATE'::public.map_visibility NOT NULL,
        id uuid NOT NULL,
        name text NOT NULL,
        description text NOT NULL,
        removed_at timestamp without time zone
    );


    ALTER TABLE public.uploaded_maps OWNER TO shieldbattery;

    --
    -- Name: user_bans; Type: TABLE; Schema: public; Owner: shieldbattery
    --

    CREATE TABLE public.user_bans (
        user_id integer NOT NULL,
        start_time timestamp without time zone NOT NULL,
        end_time timestamp without time zone NOT NULL,
        banned_by integer,
        reason text,
        id uuid DEFAULT public.uuid_generate_v4() NOT NULL
    );


    ALTER TABLE public.user_bans OWNER TO shieldbattery;

    --
    -- Name: user_identifier_bans; Type: TABLE; Schema: public; Owner: shieldbattery
    --

    CREATE TABLE public.user_identifier_bans (
        identifier_type smallint NOT NULL,
        identifier_hash bytea NOT NULL,
        time_banned timestamp without time zone NOT NULL,
        banned_until timestamp without time zone NOT NULL,
        first_user_id integer NOT NULL
    );


    ALTER TABLE public.user_identifier_bans OWNER TO shieldbattery;

    --
    -- Name: user_identifiers; Type: TABLE; Schema: public; Owner: shieldbattery
    --

    CREATE TABLE public.user_identifiers (
        user_id integer NOT NULL,
        identifier_type smallint NOT NULL,
        identifier_hash bytea NOT NULL,
        first_used timestamp without time zone NOT NULL,
        last_used timestamp without time zone NOT NULL,
        times_seen integer DEFAULT 1 NOT NULL
    );


    ALTER TABLE public.user_identifiers OWNER TO shieldbattery;

    --
    -- Name: user_ips; Type: TABLE; Schema: public; Owner: shieldbattery
    --

    CREATE TABLE public.user_ips (
        user_id integer NOT NULL,
        ip_address inet NOT NULL,
        first_used timestamp without time zone NOT NULL,
        last_used timestamp without time zone NOT NULL,
        times_seen integer DEFAULT 1 NOT NULL
    );


    ALTER TABLE public.user_ips OWNER TO shieldbattery;

    --
    -- Name: user_relationships; Type: TABLE; Schema: public; Owner: shieldbattery
    --

    CREATE TABLE public.user_relationships (
        user_low integer NOT NULL,
        user_high integer NOT NULL,
        kind public.relationship_kind NOT NULL,
        low_created_at timestamp without time zone,
        high_created_at timestamp without time zone,
        CONSTRAINT user_relationships_check CHECK ((user_low < user_high))
    );


    ALTER TABLE public.user_relationships OWNER TO shieldbattery;

    --
    -- Name: user_stats; Type: TABLE; Schema: public; Owner: shieldbattery
    --

    CREATE TABLE public.user_stats (
        user_id integer NOT NULL,
        p_wins integer DEFAULT 0 NOT NULL,
        p_losses integer DEFAULT 0 NOT NULL,
        t_wins integer DEFAULT 0 NOT NULL,
        t_losses integer DEFAULT 0 NOT NULL,
        z_wins integer DEFAULT 0 NOT NULL,
        z_losses integer DEFAULT 0 NOT NULL,
        r_wins integer DEFAULT 0 NOT NULL,
        r_losses integer DEFAULT 0 NOT NULL,
        r_p_wins integer DEFAULT 0 NOT NULL,
        r_p_losses integer DEFAULT 0 NOT NULL,
        r_t_wins integer DEFAULT 0 NOT NULL,
        r_t_losses integer DEFAULT 0 NOT NULL,
        r_z_wins integer DEFAULT 0 NOT NULL,
        r_z_losses integer DEFAULT 0 NOT NULL
    );


    ALTER TABLE public.user_stats OWNER TO shieldbattery;

    --
    -- Name: users; Type: TABLE; Schema: public; Owner: shieldbattery
    --

    CREATE TABLE public.users (
        id integer NOT NULL,
        name public.citext NOT NULL,
        created timestamp without time zone NOT NULL,
        email character varying(100) NOT NULL,
        signup_ip_address inet,
        email_verified boolean DEFAULT false NOT NULL,
        accepted_privacy_version integer DEFAULT 0 NOT NULL,
        accepted_terms_version integer DEFAULT 0 NOT NULL,
        accepted_use_policy_version integer DEFAULT 0 NOT NULL,
        locale text,
        login_name public.citext NOT NULL,
        CONSTRAINT login_name_length_check CHECK ((length((login_name)::text) <= 32)),
        CONSTRAINT name_length_check CHECK ((length((name)::text) <= 32))
    );


    ALTER TABLE public.users OWNER TO shieldbattery;

    --
    -- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: shieldbattery
    --

    CREATE SEQUENCE public.users_id_seq
        AS integer
        START WITH 1
        INCREMENT BY 1
        NO MINVALUE
        NO MAXVALUE
        CACHE 1;


    ALTER SEQUENCE public.users_id_seq OWNER TO shieldbattery;

    --
    -- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: shieldbattery
    --

    ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


    --
    -- Name: users_private; Type: TABLE; Schema: public; Owner: shieldbattery
    --

    CREATE TABLE public.users_private (
        user_id integer NOT NULL,
        password character varying(60) NOT NULL
    );


    ALTER TABLE public.users_private OWNER TO shieldbattery;

    --
    -- Name: whisper_messages; Type: TABLE; Schema: public; Owner: shieldbattery
    --

    CREATE TABLE public.whisper_messages (
        id uuid DEFAULT public.sb_uuid() NOT NULL,
        from_id integer NOT NULL,
        to_id integer NOT NULL,
        sent timestamp without time zone NOT NULL,
        data jsonb NOT NULL
    );


    ALTER TABLE public.whisper_messages OWNER TO shieldbattery;

    --
    -- Name: whisper_sessions; Type: TABLE; Schema: public; Owner: shieldbattery
    --

    CREATE TABLE public.whisper_sessions (
        user_id integer NOT NULL,
        target_user_id integer NOT NULL,
        start_date timestamp without time zone NOT NULL
    );


    ALTER TABLE public.whisper_sessions OWNER TO shieldbattery;

    --
    -- Name: channels id; Type: DEFAULT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.channels ALTER COLUMN id SET DEFAULT nextval('public.channels_id_seq'::regclass);


    --
    -- Name: matchmaking_map_pools id; Type: DEFAULT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.matchmaking_map_pools ALTER COLUMN id SET DEFAULT nextval('public.matchmaking_map_pools_id_seq'::regclass);


    --
    -- Name: matchmaking_seasons id; Type: DEFAULT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.matchmaking_seasons ALTER COLUMN id SET DEFAULT nextval('public.matchmaking_seasons_id_seq'::regclass);


    --
    -- Name: matchmaking_times id; Type: DEFAULT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.matchmaking_times ALTER COLUMN id SET DEFAULT nextval('public.matchmaking_times_id_seq'::regclass);


    --
    -- Name: rally_point_servers id; Type: DEFAULT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.rally_point_servers ALTER COLUMN id SET DEFAULT nextval('public.rally_point_servers_id_seq'::regclass);


    --
    -- Name: users id; Type: DEFAULT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


    --
    -- Name: bug_reports bug_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.bug_reports
        ADD CONSTRAINT bug_reports_pkey PRIMARY KEY (id);


    --
    -- Name: channel_bans channel_bans_pkey; Type: CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.channel_bans
        ADD CONSTRAINT channel_bans_pkey PRIMARY KEY (channel_id, user_id);


    --
    -- Name: channel_identifier_bans channel_identifier_bans_pkey; Type: CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.channel_identifier_bans
        ADD CONSTRAINT channel_identifier_bans_pkey PRIMARY KEY (channel_id, identifier_type, identifier_hash);


    --
    -- Name: channel_messages channel_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.channel_messages
        ADD CONSTRAINT channel_messages_pkey PRIMARY KEY (id);


    --
    -- Name: channels channel_name_unique; Type: CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.channels
        ADD CONSTRAINT channel_name_unique UNIQUE (name);


    --
    -- Name: channel_users channel_users_pkey; Type: CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.channel_users
        ADD CONSTRAINT channel_users_pkey PRIMARY KEY (user_id, channel_id);


    --
    -- Name: channels channels_pkey; Type: CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.channels
        ADD CONSTRAINT channels_pkey PRIMARY KEY (id);


    --
    -- Name: email_verifications email_verifications_pkey; Type: CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.email_verifications
        ADD CONSTRAINT email_verifications_pkey PRIMARY KEY (user_id, verification_code);


    --
    -- Name: favorited_maps favorited_maps_pkey; Type: CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.favorited_maps
        ADD CONSTRAINT favorited_maps_pkey PRIMARY KEY (map_id, favorited_by);


    --
    -- Name: games games_pkey; Type: CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.games
        ADD CONSTRAINT games_pkey PRIMARY KEY (id);


    --
    -- Name: games_users games_users_pkey; Type: CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.games_users
        ADD CONSTRAINT games_users_pkey PRIMARY KEY (user_id, game_id);


    --
    -- Name: league_user_changes league_user_changes_pkey; Type: CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.league_user_changes
        ADD CONSTRAINT league_user_changes_pkey PRIMARY KEY (user_id, league_id, game_id);


    --
    -- Name: league_users league_users_pkey; Type: CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.league_users
        ADD CONSTRAINT league_users_pkey PRIMARY KEY (league_id, user_id);


    --
    -- Name: leagues leagues_pkey; Type: CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.leagues
        ADD CONSTRAINT leagues_pkey PRIMARY KEY (id);


    --
    -- Name: lobby_preferences lobby_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.lobby_preferences
        ADD CONSTRAINT lobby_preferences_pkey PRIMARY KEY (user_id);


    --
    -- Name: maps maps_pkey; Type: CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.maps
        ADD CONSTRAINT maps_pkey PRIMARY KEY (hash);


    --
    -- Name: matchmaking_completions matchmaking_completions_pkey; Type: CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.matchmaking_completions
        ADD CONSTRAINT matchmaking_completions_pkey PRIMARY KEY (id);


    --
    -- Name: matchmaking_finalized_ranks matchmaking_finalized_ranks_pkey; Type: CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.matchmaking_finalized_ranks
        ADD CONSTRAINT matchmaking_finalized_ranks_pkey PRIMARY KEY (season_id, matchmaking_type, user_id);


    --
    -- Name: matchmaking_map_pools matchmaking_map_pools_pkey; Type: CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.matchmaking_map_pools
        ADD CONSTRAINT matchmaking_map_pools_pkey PRIMARY KEY (id);


    --
    -- Name: matchmaking_preferences matchmaking_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.matchmaking_preferences
        ADD CONSTRAINT matchmaking_preferences_pkey PRIMARY KEY (user_id, matchmaking_type);


    --
    -- Name: matchmaking_rating_changes matchmaking_rating_changes_pkey; Type: CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.matchmaking_rating_changes
        ADD CONSTRAINT matchmaking_rating_changes_pkey PRIMARY KEY (user_id, matchmaking_type, game_id);


    --
    -- Name: matchmaking_ratings matchmaking_ratings_pkey; Type: CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.matchmaking_ratings
        ADD CONSTRAINT matchmaking_ratings_pkey PRIMARY KEY (user_id, matchmaking_type, season_id);


    --
    -- Name: matchmaking_seasons matchmaking_seasons_pkey; Type: CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.matchmaking_seasons
        ADD CONSTRAINT matchmaking_seasons_pkey PRIMARY KEY (id);


    --
    -- Name: matchmaking_times matchmaking_times_pkey; Type: CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.matchmaking_times
        ADD CONSTRAINT matchmaking_times_pkey PRIMARY KEY (id);


    --
    -- Name: migrations migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.migrations
        ADD CONSTRAINT migrations_pkey PRIMARY KEY (id);


    --
    -- Name: news_post_edits news_post_edits_pkey; Type: CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.news_post_edits
        ADD CONSTRAINT news_post_edits_pkey PRIMARY KEY (id);


    --
    -- Name: news_posts news_posts_pkey; Type: CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.news_posts
        ADD CONSTRAINT news_posts_pkey PRIMARY KEY (id);


    --
    -- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.notifications
        ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


    --
    -- Name: password_resets password_resets_pkey; Type: CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.password_resets
        ADD CONSTRAINT password_resets_pkey PRIMARY KEY (user_id, reset_code);


    --
    -- Name: permissions permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.permissions
        ADD CONSTRAINT permissions_pkey PRIMARY KEY (user_id);


    --
    -- Name: rally_point_servers rally_point_servers_pkey; Type: CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.rally_point_servers
        ADD CONSTRAINT rally_point_servers_pkey PRIMARY KEY (id);


    --
    -- Name: uploaded_maps uploaded_maps_map_hash_uploaded_by_visibility_key; Type: CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.uploaded_maps
        ADD CONSTRAINT uploaded_maps_map_hash_uploaded_by_visibility_key UNIQUE (map_hash, uploaded_by, visibility);


    --
    -- Name: uploaded_maps uploaded_maps_pkey; Type: CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.uploaded_maps
        ADD CONSTRAINT uploaded_maps_pkey PRIMARY KEY (id);


    --
    -- Name: user_bans user_bans_pkey; Type: CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.user_bans
        ADD CONSTRAINT user_bans_pkey PRIMARY KEY (id);


    --
    -- Name: user_identifier_bans user_identifier_bans_pkey; Type: CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.user_identifier_bans
        ADD CONSTRAINT user_identifier_bans_pkey PRIMARY KEY (identifier_type, identifier_hash);


    --
    -- Name: user_identifiers user_identifiers_pkey; Type: CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.user_identifiers
        ADD CONSTRAINT user_identifiers_pkey PRIMARY KEY (user_id, identifier_type, identifier_hash);


    --
    -- Name: user_ips user_ips_pkey; Type: CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.user_ips
        ADD CONSTRAINT user_ips_pkey PRIMARY KEY (user_id, ip_address);


    --
    -- Name: user_relationships user_relationships_pkey; Type: CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.user_relationships
        ADD CONSTRAINT user_relationships_pkey PRIMARY KEY (user_low, user_high);


    --
    -- Name: user_stats user_stats_pkey; Type: CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.user_stats
        ADD CONSTRAINT user_stats_pkey PRIMARY KEY (user_id);


    --
    -- Name: users users_login_name_key; Type: CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.users
        ADD CONSTRAINT users_login_name_key UNIQUE (login_name);


    --
    -- Name: users users_name_key; Type: CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.users
        ADD CONSTRAINT users_name_key UNIQUE (name);


    --
    -- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.users
        ADD CONSTRAINT users_pkey PRIMARY KEY (id);


    --
    -- Name: users_private users_private_pkey; Type: CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.users_private
        ADD CONSTRAINT users_private_pkey PRIMARY KEY (user_id);


    --
    -- Name: whisper_messages whisper_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.whisper_messages
        ADD CONSTRAINT whisper_messages_pkey PRIMARY KEY (id);


    --
    -- Name: whisper_sessions whisper_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.whisper_sessions
        ADD CONSTRAINT whisper_sessions_pkey PRIMARY KEY (user_id, target_user_id);


    --
    -- Name: bug_reports_id_idx; Type: INDEX; Schema: public; Owner: shieldbattery
    --

    CREATE INDEX bug_reports_id_idx ON public.bug_reports USING btree (id) WHERE (resolved_at IS NULL);


    --
    -- Name: change_date_index; Type: INDEX; Schema: public; Owner: shieldbattery
    --

    CREATE INDEX change_date_index ON public.matchmaking_rating_changes USING btree (change_date DESC);


    --
    -- Name: channel_messages_channel_id_index; Type: INDEX; Schema: public; Owner: shieldbattery
    --

    CREATE INDEX channel_messages_channel_id_index ON public.channel_messages USING btree (channel_id);


    --
    -- Name: channel_messages_sent_index; Type: INDEX; Schema: public; Owner: shieldbattery
    --

    CREATE INDEX channel_messages_sent_index ON public.channel_messages USING btree (sent DESC);


    --
    -- Name: channel_users_channel_id_index; Type: INDEX; Schema: public; Owner: shieldbattery
    --

    CREATE INDEX channel_users_channel_id_index ON public.channel_users USING btree (channel_id);


    --
    -- Name: created_at_index; Type: INDEX; Schema: public; Owner: shieldbattery
    --

    CREATE INDEX created_at_index ON public.notifications USING btree (created_at DESC);


    --
    -- Name: favorited_by_index; Type: INDEX; Schema: public; Owner: shieldbattery
    --

    CREATE INDEX favorited_by_index ON public.favorited_maps USING btree (favorited_by);


    --
    -- Name: game_id_index; Type: INDEX; Schema: public; Owner: shieldbattery
    --

    CREATE INDEX game_id_index ON public.matchmaking_rating_changes USING btree (game_id);


    --
    -- Name: games_users_game_id_index; Type: INDEX; Schema: public; Owner: shieldbattery
    --

    CREATE INDEX games_users_game_id_index ON public.games_users USING btree (game_id);


    --
    -- Name: games_users_null_result_index; Type: INDEX; Schema: public; Owner: shieldbattery
    --

    CREATE INDEX games_users_null_result_index ON public.games_users USING btree (game_id) INCLUDE (reported_at) WHERE ((reported_results IS NOT NULL) AND (result IS NULL));


    --
    -- Name: league_user_changes_game_id_idx; Type: INDEX; Schema: public; Owner: shieldbattery
    --

    CREATE INDEX league_user_changes_game_id_idx ON public.league_user_changes USING btree (game_id);


    --
    -- Name: league_user_changes_user_id_idx; Type: INDEX; Schema: public; Owner: shieldbattery
    --

    CREATE INDEX league_user_changes_user_id_idx ON public.league_user_changes USING btree (user_id);


    --
    -- Name: league_users_user_id_idx; Type: INDEX; Schema: public; Owner: shieldbattery
    --

    CREATE INDEX league_users_user_id_idx ON public.league_users USING btree (user_id);


    --
    -- Name: leagues_end_at_idx; Type: INDEX; Schema: public; Owner: shieldbattery
    --

    CREATE INDEX leagues_end_at_idx ON public.leagues USING btree (end_at DESC);


    --
    -- Name: matchmaking_completions_user_id_index; Type: INDEX; Schema: public; Owner: shieldbattery
    --

    CREATE INDEX matchmaking_completions_user_id_index ON public.matchmaking_completions USING btree (user_id);


    --
    -- Name: matchmaking_finalized_ranks_rank; Type: INDEX; Schema: public; Owner: shieldbattery
    --

    CREATE INDEX matchmaking_finalized_ranks_rank ON public.matchmaking_finalized_ranks USING btree (season_id, matchmaking_type, rank);


    --
    -- Name: matchmaking_ratings_points; Type: INDEX; Schema: public; Owner: shieldbattery
    --

    CREATE INDEX matchmaking_ratings_points ON public.matchmaking_ratings USING btree (season_id, matchmaking_type, points DESC);


    --
    -- Name: matchmaking_seasons_start_date_index; Type: INDEX; Schema: public; Owner: shieldbattery
    --

    CREATE INDEX matchmaking_seasons_start_date_index ON public.matchmaking_seasons USING btree (start_date DESC);


    --
    -- Name: news_post_edits_post_id_idx; Type: INDEX; Schema: public; Owner: shieldbattery
    --

    CREATE INDEX news_post_edits_post_id_idx ON public.news_post_edits USING btree (post_id);


    --
    -- Name: news_posts_published_at_idx; Type: INDEX; Schema: public; Owner: shieldbattery
    --

    CREATE INDEX news_posts_published_at_idx ON public.news_posts USING btree (published_at DESC);


    --
    -- Name: notification_type_index; Type: INDEX; Schema: public; Owner: shieldbattery
    --

    CREATE INDEX notification_type_index ON public.notifications USING btree (((data ->> 'type'::text)));


    --
    -- Name: start_date_index; Type: INDEX; Schema: public; Owner: shieldbattery
    --

    CREATE INDEX start_date_index ON public.matchmaking_times USING btree (start_date DESC);


    --
    -- Name: user_bans_user_id_index; Type: INDEX; Schema: public; Owner: shieldbattery
    --

    CREATE INDEX user_bans_user_id_index ON public.user_bans USING btree (user_id, start_time DESC);


    --
    -- Name: user_id_index; Type: INDEX; Schema: public; Owner: shieldbattery
    --

    CREATE INDEX user_id_index ON public.notifications USING btree (user_id);


    --
    -- Name: user_identifiers_identifier_type_hash_index; Type: INDEX; Schema: public; Owner: shieldbattery
    --

    CREATE INDEX user_identifiers_identifier_type_hash_index ON public.user_identifiers USING btree (identifier_type, identifier_hash);


    --
    -- Name: user_ips_ip_address_index; Type: INDEX; Schema: public; Owner: shieldbattery
    --

    CREATE INDEX user_ips_ip_address_index ON public.user_ips USING btree (ip_address);


    --
    -- Name: user_relationships_user_high_idx; Type: INDEX; Schema: public; Owner: shieldbattery
    --

    CREATE INDEX user_relationships_user_high_idx ON public.user_relationships USING btree (user_high);


    --
    -- Name: users_email_index; Type: INDEX; Schema: public; Owner: shieldbattery
    --

    CREATE INDEX users_email_index ON public.users USING btree (email);


    --
    -- Name: users_signup_ip_address_index; Type: INDEX; Schema: public; Owner: shieldbattery
    --

    CREATE INDEX users_signup_ip_address_index ON public.users USING btree (signup_ip_address);


    --
    -- Name: visibility_index; Type: INDEX; Schema: public; Owner: shieldbattery
    --

    CREATE INDEX visibility_index ON public.uploaded_maps USING btree (visibility);


    --
    -- Name: whisper_messages_sent_index; Type: INDEX; Schema: public; Owner: shieldbattery
    --

    CREATE INDEX whisper_messages_sent_index ON public.whisper_messages USING btree (sent DESC);


    --
    -- Name: whisper_sessions_user_id_index; Type: INDEX; Schema: public; Owner: shieldbattery
    --

    CREATE INDEX whisper_sessions_user_id_index ON public.whisper_sessions USING btree (user_id);


    --
    -- Name: channel_users channel_users_insert_delete; Type: TRIGGER; Schema: public; Owner: shieldbattery
    --

    CREATE TRIGGER channel_users_insert_delete AFTER INSERT OR DELETE ON public.channel_users FOR EACH ROW EXECUTE FUNCTION public.update_channels_user_count();


    --
    -- Name: bug_reports bug_reports_resolver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.bug_reports
        ADD CONSTRAINT bug_reports_resolver_id_fkey FOREIGN KEY (resolver_id) REFERENCES public.users(id) ON DELETE SET NULL;


    --
    -- Name: bug_reports bug_reports_submitter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.bug_reports
        ADD CONSTRAINT bug_reports_submitter_id_fkey FOREIGN KEY (submitter_id) REFERENCES public.users(id) ON DELETE SET NULL;


    --
    -- Name: channel_bans channel_bans_banned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.channel_bans
        ADD CONSTRAINT channel_bans_banned_by_fkey FOREIGN KEY (banned_by) REFERENCES public.users(id) ON DELETE CASCADE;


    --
    -- Name: channel_bans channel_bans_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.channel_bans
        ADD CONSTRAINT channel_bans_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


    --
    -- Name: channels channels_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.channels
        ADD CONSTRAINT channels_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id);


    --
    -- Name: favorited_maps favorited_maps_favorited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.favorited_maps
        ADD CONSTRAINT favorited_maps_favorited_by_fkey FOREIGN KEY (favorited_by) REFERENCES public.users(id);


    --
    -- Name: favorited_maps favorited_maps_map_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.favorited_maps
        ADD CONSTRAINT favorited_maps_map_id_fkey FOREIGN KEY (map_id) REFERENCES public.uploaded_maps(id);


    --
    -- Name: channel_users fk_channel_id; Type: FK CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.channel_users
        ADD CONSTRAINT fk_channel_id FOREIGN KEY (channel_id) REFERENCES public.channels(id);


    --
    -- Name: channel_bans fk_channel_id; Type: FK CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.channel_bans
        ADD CONSTRAINT fk_channel_id FOREIGN KEY (channel_id) REFERENCES public.channels(id) ON DELETE CASCADE;


    --
    -- Name: channel_messages fk_channel_id; Type: FK CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.channel_messages
        ADD CONSTRAINT fk_channel_id FOREIGN KEY (channel_id) REFERENCES public.channels(id) ON DELETE CASCADE;


    --
    -- Name: channel_identifier_bans fk_channel_id; Type: FK CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.channel_identifier_bans
        ADD CONSTRAINT fk_channel_id FOREIGN KEY (channel_id) REFERENCES public.channels(id) ON DELETE CASCADE;


    --
    -- Name: channel_users fk_user_id; Type: FK CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.channel_users
        ADD CONSTRAINT fk_user_id FOREIGN KEY (user_id) REFERENCES public.users(id);


    --
    -- Name: league_user_changes league_user_changes_game_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.league_user_changes
        ADD CONSTRAINT league_user_changes_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.games(id) ON DELETE CASCADE;


    --
    -- Name: league_user_changes league_user_changes_league_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.league_user_changes
        ADD CONSTRAINT league_user_changes_league_id_fkey FOREIGN KEY (league_id) REFERENCES public.leagues(id) ON DELETE CASCADE;


    --
    -- Name: league_user_changes league_user_changes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.league_user_changes
        ADD CONSTRAINT league_user_changes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


    --
    -- Name: league_users league_users_league_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.league_users
        ADD CONSTRAINT league_users_league_id_fkey FOREIGN KEY (league_id) REFERENCES public.leagues(id) ON DELETE CASCADE;


    --
    -- Name: league_users league_users_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.league_users
        ADD CONSTRAINT league_users_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


    --
    -- Name: matchmaking_finalized_ranks matchmaking_finalized_ranks_season_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.matchmaking_finalized_ranks
        ADD CONSTRAINT matchmaking_finalized_ranks_season_id_fkey FOREIGN KEY (season_id) REFERENCES public.matchmaking_seasons(id) ON DELETE CASCADE;


    --
    -- Name: matchmaking_finalized_ranks matchmaking_finalized_ranks_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.matchmaking_finalized_ranks
        ADD CONSTRAINT matchmaking_finalized_ranks_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


    --
    -- Name: news_post_edits news_post_edits_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.news_post_edits
        ADD CONSTRAINT news_post_edits_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE SET NULL;


    --
    -- Name: news_post_edits news_post_edits_editor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.news_post_edits
        ADD CONSTRAINT news_post_edits_editor_id_fkey FOREIGN KEY (editor_id) REFERENCES public.users(id) ON DELETE SET NULL;


    --
    -- Name: news_post_edits news_post_edits_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.news_post_edits
        ADD CONSTRAINT news_post_edits_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.news_posts(id) ON DELETE CASCADE;


    --
    -- Name: news_posts news_posts_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.news_posts
        ADD CONSTRAINT news_posts_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE SET NULL;


    --
    -- Name: uploaded_maps uploaded_maps_map_hash_fkey; Type: FK CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.uploaded_maps
        ADD CONSTRAINT uploaded_maps_map_hash_fkey FOREIGN KEY (map_hash) REFERENCES public.maps(hash);


    --
    -- Name: uploaded_maps uploaded_maps_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.uploaded_maps
        ADD CONSTRAINT uploaded_maps_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.users(id);


    --
    -- Name: user_relationships user_relationships_user_high_fkey; Type: FK CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.user_relationships
        ADD CONSTRAINT user_relationships_user_high_fkey FOREIGN KEY (user_high) REFERENCES public.users(id) ON DELETE CASCADE;


    --
    -- Name: user_relationships user_relationships_user_low_fkey; Type: FK CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.user_relationships
        ADD CONSTRAINT user_relationships_user_low_fkey FOREIGN KEY (user_low) REFERENCES public.users(id) ON DELETE CASCADE;


    --
    -- Name: users_private users_private_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: shieldbattery
    --

    ALTER TABLE ONLY public.users_private
        ADD CONSTRAINT users_private_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);

  END IF;
END$$;

--
-- Name: sb_uuid(); Type: FUNCTION; Schema: public; Owner: shieldbattery
-- https://gist.github.com/kjmph/5bd772b2c2df145aa645b837da7eca74
--

CREATE OR REPLACE FUNCTION public.sb_uuid()
RETURNS uuid
as $$
begin
  -- use random v4 uuid as starting point (which has the same variant we need)
  -- then overlay timestamp
  -- then set version 7 by flipping the 2 and 1 bit in the version 4 string
  return encode(
    set_bit(
      set_bit(
        overlay(uuid_send(gen_random_uuid())
                placing substring(int8send(floor(extract(epoch from clock_timestamp()) * 1000)::bigint) from 3)
                from 1 for 6
        ),
        52, 1
      ),
      53, 1
    ),
    'hex')::uuid;
end
$$
LANGUAGE plpgsql volatile;


ALTER FUNCTION public.sb_uuid() OWNER TO shieldbattery;

--
-- Name: update_channels_user_count(); Type: FUNCTION; Schema: public; Owner: shieldbattery
--

CREATE OR REPLACE FUNCTION public.update_channels_user_count() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
      BEGIN
        IF (TG_OP = 'DELETE') THEN
          UPDATE channels
          SET user_count = user_count - 1
          WHERE id = OLD.channel_id;

          RETURN OLD;
        ELSIF (TG_OP = 'INSERT') THEN
          UPDATE channels
          SET user_count = user_count + 1
          WHERE id = NEW.channel_id;

          RETURN NEW;
        END IF;

        RETURN NULL;
      END;
    $$;


ALTER FUNCTION public.update_channels_user_count() OWNER TO shieldbattery;
