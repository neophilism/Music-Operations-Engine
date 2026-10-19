export const migrations = [
  {version:1,sql:`
    CREATE TABLE IF NOT EXISTS music_label_families (id text PRIMARY KEY,name text NOT NULL);
    CREATE TABLE IF NOT EXISTS music_labels (id text PRIMARY KEY,name text NOT NULL);
    INSERT INTO music_labels(id,name) VALUES ('default','Unassigned legacy facts') ON CONFLICT DO NOTHING;
    CREATE TABLE IF NOT EXISTS music_label_memberships (
      label_id text REFERENCES music_labels(id),family_id text REFERENCES music_label_families(id),PRIMARY KEY(label_id,family_id));
    CREATE TABLE IF NOT EXISTS music_catalog (
      label_id text REFERENCES music_labels(id),id text,kind text NOT NULL CHECK(kind IN ('artist','release','track')),
      name text NOT NULL,artist_id text,release_id text,isrc text,upc text,PRIMARY KEY(label_id,id),
      FOREIGN KEY(label_id,artist_id) REFERENCES music_catalog(label_id,id),
      FOREIGN KEY(label_id,release_id) REFERENCES music_catalog(label_id,id));
    CREATE TABLE IF NOT EXISTS music_external_ids (
      label_id text,source text,kind text,external_id text,catalog_id text NOT NULL,
      PRIMARY KEY(label_id,source,kind,external_id),FOREIGN KEY(label_id,catalog_id) REFERENCES music_catalog(label_id,id));
    CREATE TABLE IF NOT EXISTS music_facts (
      id text PRIMARY KEY,source text NOT NULL,external_id text NOT NULL,type text NOT NULL,occurred_at timestamptz NOT NULL,
      quantity bigint NOT NULL,amount_minor bigint NOT NULL,currency char(3) NOT NULL,artist text NOT NULL,release_title text NOT NULL,
      track text NOT NULL,channel text NOT NULL,territory text NOT NULL,metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      updated_at timestamptz NOT NULL DEFAULT now());
    ALTER TABLE music_facts ADD COLUMN IF NOT EXISTS label_id text NOT NULL DEFAULT 'default' REFERENCES music_labels(id);
    ALTER TABLE music_facts ADD COLUMN IF NOT EXISTS artist_id text;
    ALTER TABLE music_facts ADD COLUMN IF NOT EXISTS release_id text;
    ALTER TABLE music_facts ADD COLUMN IF NOT EXISTS track_id text;
    CREATE UNIQUE INDEX IF NOT EXISTS music_facts_label_source_external ON music_facts(label_id,source,external_id);
    CREATE INDEX IF NOT EXISTS music_facts_scope_time ON music_facts(label_id,occurred_at,id);
    CREATE INDEX IF NOT EXISTS music_facts_source_time ON music_facts(source,occurred_at,id);
    CREATE TABLE IF NOT EXISTS music_audit (
      id bigserial PRIMARY KEY,actor text NOT NULL,action text NOT NULL,label_ids text[] NOT NULL,
      details jsonb NOT NULL DEFAULT '{}'::jsonb,created_at timestamptz NOT NULL DEFAULT now());
  `},
  {version:2,sql:`
    CREATE TABLE music_deliveries (
      label_id text REFERENCES music_labels(id),platform text,delivery_id text,content_hash text NOT NULL,
      accepted bigint NOT NULL DEFAULT 0,received_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(label_id,platform,delivery_id));
    CREATE TABLE music_platform_events (
      label_id text REFERENCES music_labels(id),platform text,external_id text,content_hash text NOT NULL,
      received_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(label_id,platform,external_id));
    CREATE TABLE music_shared_measurements (
      source text,activity_id text,type text NOT NULL,quantity bigint NOT NULL,metrics jsonb NOT NULL,
      PRIMARY KEY(source,activity_id));
    CREATE INDEX music_deliveries_received_at ON music_deliveries(received_at);
  `},
  {version:3,sql:`
    CREATE TABLE music_accounts (
      id text PRIMARY KEY,email text NOT NULL UNIQUE,password_salt char(32) NOT NULL,password_hash char(128) NOT NULL,
      role text NOT NULL CHECK(role IN ('tenant_admin','label_manager','team_member','artist')),
      label_ids text[] NOT NULL,disabled_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
      CHECK(email=lower(email)),
      CHECK((role='tenant_admin' AND label_ids=ARRAY['*']::text[]) OR (role<>'tenant_admin' AND cardinality(label_ids)>0 AND NOT ('*'=ANY(label_ids))))
    );
    CREATE TABLE music_account_sessions (
      id text PRIMARY KEY,account_id text NOT NULL REFERENCES music_accounts(id) ON DELETE CASCADE,
      token_hash char(64) NOT NULL UNIQUE,created_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,
      revoked_at timestamptz,last_seen_at timestamptz NOT NULL,
      CHECK(expires_at>created_at)
    );
    CREATE INDEX music_account_sessions_active ON music_account_sessions(account_id,expires_at) WHERE revoked_at IS NULL;
  `},
  {version:4,sql:`
    CREATE TABLE music_jobs (
      id text PRIMARY KEY,kind text NOT NULL CHECK(kind IN ('ingest','resync')),source text NOT NULL,
      label_id text NOT NULL REFERENCES music_labels(id),payload jsonb NOT NULL DEFAULT '{}'::jsonb,
      status text NOT NULL CHECK(status IN ('queued','running','retry','succeeded','dead_letter')),
      attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),max_attempts integer NOT NULL CHECK(max_attempts BETWEEN 1 AND 10),
      available_at timestamptz NOT NULL,locked_by text,locked_at timestamptz,last_error_code text,
      created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL,completed_at timestamptz,
      CHECK((status='running')=(locked_by IS NOT NULL AND locked_at IS NOT NULL)),
      CHECK(status<>'succeeded' OR completed_at IS NOT NULL)
    );
    CREATE INDEX music_jobs_claimable ON music_jobs(source,available_at,created_at,id) WHERE status IN ('queued','retry');
    CREATE INDEX music_jobs_scope_status ON music_jobs(label_id,source,status,updated_at);
  `},
  {version:5,sql:`
    CREATE TABLE music_connectors (
      label_id text NOT NULL REFERENCES music_labels(id),source text NOT NULL,
      display_name text NOT NULL,adapter_version text NOT NULL,capabilities text[] NOT NULL,
      field_mapping jsonb NOT NULL,backfill_cursor text,created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(label_id,source)
    );
    CREATE TABLE music_connector_credentials (
      label_id text NOT NULL,source text NOT NULL,ciphertext text NOT NULL,iv text NOT NULL,
      auth_tag text NOT NULL,key_version text NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(label_id,source),
      FOREIGN KEY(label_id,source) REFERENCES music_connectors(label_id,source) ON DELETE CASCADE
    );
    CREATE INDEX music_connectors_source ON music_connectors(source,label_id);
  `},

  {version:6,sql:`
    CREATE TABLE music_distributor_statements (
      label_id text NOT NULL REFERENCES music_labels(id),source text NOT NULL,statement_id text NOT NULL,
      content_hash char(64) NOT NULL,row_count integer NOT NULL CHECK(row_count>=0),
      imported_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(label_id,source,statement_id)
    );
    CREATE TABLE music_distributor_rows (
      id char(64) PRIMARY KEY,label_id text NOT NULL REFERENCES music_labels(id),source text NOT NULL,
      external_id text NOT NULL,statement_id text NOT NULL,isrc char(12) NOT NULL,
      artist_id text NOT NULL,release_id text NOT NULL,track_id text NOT NULL,
      occurred_at date NOT NULL,currency char(3) NOT NULL,
      gross_minor bigint NOT NULL,fees_minor bigint NOT NULL,net_minor bigint NOT NULL,
      provider_status text NOT NULL CHECK(provider_status IN ('reported','pending','settled','reversed')),
      provider_settlement_id text,row_hash char(64) NOT NULL,imported_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(label_id,source,external_id),
      FOREIGN KEY(label_id,source,statement_id) REFERENCES music_distributor_statements(label_id,source,statement_id),
      FOREIGN KEY(label_id,artist_id) REFERENCES music_catalog(label_id,id),
      FOREIGN KEY(label_id,release_id) REFERENCES music_catalog(label_id,id),
      FOREIGN KEY(label_id,track_id) REFERENCES music_catalog(label_id,id)
    );
    CREATE INDEX music_distributor_rows_scope ON music_distributor_rows(label_id,source,occurred_at,id);
  `},

  {version:7,sql:`
    CREATE TABLE music_distributor_reconciliations (
      label_id text NOT NULL REFERENCES music_labels(id),source text NOT NULL,provider_settlement_id text NOT NULL,
      currency char(3) NOT NULL,provider_minor bigint NOT NULL,invoice_id text NOT NULL,
      invoice_minor bigint NOT NULL,bank_transaction_id text NOT NULL,bank_minor bigint NOT NULL,
      row_count integer NOT NULL CHECK(row_count>0),recorded_by text NOT NULL,
      recorded_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(label_id,source,provider_settlement_id),
      UNIQUE(label_id,bank_transaction_id),
      UNIQUE(label_id,invoice_id)
    );
  `},

  {version:8,sql:`
    ALTER TABLE music_distributor_rows ADD COLUMN reverses_external_id text;
    ALTER TABLE music_distributor_rows ADD CONSTRAINT music_distributor_reversal_original
      FOREIGN KEY(label_id,source,reverses_external_id)
      REFERENCES music_distributor_rows(label_id,source,external_id) DEFERRABLE INITIALLY DEFERRED;
    CREATE UNIQUE INDEX music_distributor_one_reversal
      ON music_distributor_rows(label_id,source,reverses_external_id)
      WHERE reverses_external_id IS NOT NULL;
  `},

  {version:9,sql:`
    ALTER TABLE music_distributor_rows ADD COLUMN provider_upc text;
    ALTER TABLE music_distributor_rows ADD CONSTRAINT music_distributor_provider_upc_format
      CHECK(provider_upc IS NULL OR provider_upc ~ '^[0-9]{12,13}$');
  `}
];

export async function migrate(pool) {
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(76203491)');
    await client.query('CREATE TABLE IF NOT EXISTS music_schema_migrations (version integer PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())');
    for (const migration of migrations) {
      const result=await client.query('SELECT 1 FROM music_schema_migrations WHERE version=$1',[migration.version]);
      if (!result.rows.length) {
        await client.query(migration.sql);
        await client.query('INSERT INTO music_schema_migrations(version) VALUES ($1)',[migration.version]);
      }
    }
    await client.query('COMMIT');
  } catch(error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
