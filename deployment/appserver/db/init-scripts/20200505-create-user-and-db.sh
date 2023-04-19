#!/bin/bash
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" << EOSQL

CREATE USER "$SB_DB_USER" WITH LOGIN
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  INHERIT
  NOREPLICATION
  CONNECTION LIMIT -1
  PASSWORD '$SB_DB_PASSWORD';

CREATE DATABASE "$SB_DB";

GRANT ALL PRIVILEGES ON DATABASE "$SB_DB" TO "$SB_DB_USER";
ALTER DATABASE "$SB_DB" OWNER TO "$SB_DB_USER";

EOSQL

# NOTE(tec27): If you add extensions to this list, note that they won't apply to existing DBs, so
# those will either have to be remade and restored from a data backup, or the new commands will
# need to be manually run, e.g.
#
# $ echo "CREATE EXTENSION IF NOT EXISTS whatever WITH SCHEMA public;" | docker exec -i shieldbattery_db_1 psql -U postgres --dbname "shieldbattery"
#
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$SB_DB" << EOSQL

CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;

EOSQL
