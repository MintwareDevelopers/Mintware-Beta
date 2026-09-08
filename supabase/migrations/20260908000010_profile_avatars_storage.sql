-- Profile pictures — Supabase Storage bucket `avatars` (2026-09-08).
--
-- Written ONLY by the server (service role) from POST /api/profile/avatar, which sniffs the MIME from
-- magic bytes, enforces ≤ 2 MB, and stores at `<wallet>/<uuid>.<ext>`. Public READ so the URL saved in
-- `wallet_profiles.avatar_ref` renders anywhere (CSP img-src already allows https:). No anon/authenticated
-- INSERT/UPDATE/DELETE policies exist → every non-service write is denied by RLS on storage.objects
-- (Supabase enables RLS on storage.objects by default; the service role bypasses it).
--
-- The bucket's own limits (file_size_limit + allowed_mime_types) are a second fence behind the route's.
--
-- ⚠ Hosted projects: `storage.buckets` / `storage.objects` are owned by `supabase_storage_admin`. When
-- this migration runs as a role that can't write them it raises a NOTICE (not an error) and you create
-- the bucket + policy in the dashboard instead — steps in docs/developers/audits/closeout/profile-leaderboard.md.

DO $$
BEGIN
  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES ('avatars', 'avatars', true, 2097152, ARRAY['image/png', 'image/jpeg', 'image/webp'])
  ON CONFLICT (id) DO UPDATE
    SET public = EXCLUDED.public,
        file_size_limit = EXCLUDED.file_size_limit,
        allowed_mime_types = EXCLUDED.allowed_mime_types;
EXCEPTION
  WHEN insufficient_privilege OR undefined_table THEN
    RAISE NOTICE 'avatars bucket: cannot write storage.buckets from this role — create it in the dashboard (public, 2 MB, png/jpeg/webp).';
END $$;

-- Public read of avatar objects only (bucket-scoped). Service role bypasses RLS for writes.
DO $$
BEGIN
  DROP POLICY IF EXISTS "avatars_public_read" ON storage.objects;
  CREATE POLICY "avatars_public_read"
    ON storage.objects FOR SELECT
    TO public
    USING (bucket_id = 'avatars');
EXCEPTION
  WHEN insufficient_privilege OR undefined_table THEN
    RAISE NOTICE 'avatars bucket: cannot manage storage.objects policies from this role — add a SELECT policy (bucket_id = ''avatars'') for public in the dashboard.';
END $$;

-- Explicitly NO insert/update/delete policies for anon / authenticated: writes are service-role only.
