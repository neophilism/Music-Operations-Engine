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
