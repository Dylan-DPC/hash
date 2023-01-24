#!/bin/bash
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-EOSQL
  -- Create Kratos database and user
  CREATE USER $HASH_KRATOS_PG_USER WITH PASSWORD '$HASH_KRATOS_PG_PASSWORD';

  CREATE DATABASE $HASH_KRATOS_PG_DATABASE;

  REVOKE ALL ON DATABASE $HASH_KRATOS_PG_DATABASE FROM $HASH_KRATOS_PG_USER;

  GRANT CONNECT ON DATABASE $HASH_KRATOS_PG_DATABASE TO $HASH_KRATOS_PG_USER;  

  -- Create Graph database and user
  CREATE USER $HASH_GRAPH_PG_USER WITH PASSWORD '$HASH_GRAPH_PG_PASSWORD';

  CREATE DATABASE $HASH_GRAPH_PG_DATABASE;

  REVOKE ALL ON DATABASE $HASH_GRAPH_PG_DATABASE FROM $HASH_GRAPH_PG_USER;

  GRANT CONNECT ON DATABASE $HASH_GRAPH_PG_DATABASE TO $HASH_GRAPH_PG_USER;

  -- Create Realtime user
  CREATE USER $HASH_GRAPH_REALTIME_PG_USER WITH PASSWORD '$HASH_GRAPH_REALTIME_PG_PASSWORD';

  ALTER ROLE $HASH_GRAPH_REALTIME_PG_USER REPLICATION;

EOSQL

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$HASH_KRATOS_PG_DATABASE" <<-EOSQL

  REVOKE CREATE ON SCHEMA public FROM PUBLIC;

  ALTER DEFAULT PRIVILEGES
  GRANT USAGE ON SCHEMAS TO $HASH_KRATOS_PG_USER;

  ALTER DEFAULT PRIVILEGES
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO $HASH_KRATOS_PG_USER;

EOSQL

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$HASH_GRAPH_PG_DATABASE" <<-EOSQL
  -- Graph DB
  REVOKE CREATE ON SCHEMA public FROM PUBLIC;

  ALTER DEFAULT PRIVILEGES
  GRANT USAGE ON SCHEMAS TO $HASH_GRAPH_PG_USER;

  ALTER DEFAULT PRIVILEGES
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO $HASH_GRAPH_PG_USER;

  -- Realtime
  CREATE SCHEMA realtime;

  GRANT USAGE ON SCHEMA realtime TO $HASH_GRAPH_REALTIME_PG_USER;

  CREATE TABLE realtime.ownership (
    slot_name            TEXT PRIMARY KEY,
    slot_owner           UUID NOT NULL,
    ownership_expires_at TIMESTAMP WITH TIME ZONE
  );

  GRANT INSERT, SELECT, UPDATE, DELETE ON TABLE realtime.ownership TO $HASH_GRAPH_REALTIME_PG_USER;

EOSQL