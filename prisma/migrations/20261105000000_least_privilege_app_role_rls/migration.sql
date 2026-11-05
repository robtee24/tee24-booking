-- Least-privilege runtime role + row-level security backstop. Additive; no data changes.
--
--   tee24_app   what the Next.js app connects as at runtime (DATABASE_URL).
--               Data read/write only: no DDL, no ownership, no RLS bypass.
--   postgres    migrations only (DIRECT_URL at build time). Owns the tables.
--
-- RLS is enabled on every table with a single policy that admits tee24_app and
-- nobody else, so Supabase's public API roles (anon / authenticated) can never
-- read member data even if a grant slips in later.
--
-- NEW TABLES: a table added by a later migration is reachable by tee24_app
-- automatically (default privileges below), but RLS is per-table — add
--   ALTER TABLE "X" ENABLE ROW LEVEL SECURITY;
--   CREATE POLICY tee24_app_all ON "X" FOR ALL TO tee24_app USING (true) WITH CHECK (true);
-- to that migration. Admin → Settings → Health lists any table missing it.
--
-- The role is created WITHOUT a password on purpose (NOLOGIN). Set one from the
-- Supabase SQL editor so it never passes through tooling or chat:
--   ALTER ROLE tee24_app LOGIN PASSWORD '<strong password>';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tee24_app') THEN
    CREATE ROLE tee24_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO tee24_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tee24_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO tee24_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO tee24_app;

-- Tables/sequences created by future migrations (run as postgres) are granted automatically.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tee24_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO tee24_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO tee24_app;

-- Row-level security on every existing table, allowing only tee24_app.
-- postgres (table owner, BYPASSRLS) is unaffected, so migrations keep working.
DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
      AND c.relname <> '_prisma_migrations'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.relname);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t.relname AND policyname = 'tee24_app_all'
    ) THEN
      EXECUTE format('CREATE POLICY tee24_app_all ON public.%I FOR ALL TO tee24_app USING (true) WITH CHECK (true)', t.relname);
    END IF;
  END LOOP;
END $$;
