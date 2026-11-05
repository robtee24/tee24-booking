-- Nobody but the table owner (postgres, used for migrations) may create objects in
-- public. Postgres <15 and Supabase both grant CREATE to PUBLIC / anon / authenticated
-- by default, which let the runtime role create tables. Additive hardening; no data change.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM anon;
REVOKE CREATE ON SCHEMA public FROM authenticated;
REVOKE CREATE ON SCHEMA public FROM tee24_app;
