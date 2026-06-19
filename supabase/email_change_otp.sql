-- Email change OTP verification (run on Supabase after profile_and_storage.sql)

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS "EV_EmailChangeOtps" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES "EV_Users"(id) ON DELETE CASCADE,
  new_email TEXT NOT NULL,
  otp_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ev_email_change_otps_user_id ON "EV_EmailChangeOtps" (user_id);
CREATE INDEX IF NOT EXISTS idx_ev_email_change_otps_expires_at ON "EV_EmailChangeOtps" (expires_at);

ALTER TABLE "EV_EmailChangeOtps" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ev_anon_email_otp" ON "EV_EmailChangeOtps"
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- Returns a 6-digit OTP for the app to email via Power Automate (valid 10 minutes).
CREATE OR REPLACE FUNCTION create_ev_email_change_otp(p_user_id UUID, p_new_email TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_otp TEXT;
  v_hash TEXT;
  v_new_email TEXT;
BEGIN
  v_new_email := lower(trim(p_new_email));
  IF v_new_email IS NULL OR v_new_email = '' THEN
    RAISE EXCEPTION 'Email is required';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM "EV_Users" WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "EV_Users"
    WHERE lower(email) = v_new_email AND id <> p_user_id
  ) THEN
    RAISE EXCEPTION 'Email is already in use by another account';
  END IF;

  DELETE FROM "EV_EmailChangeOtps" WHERE user_id = p_user_id;

  v_otp := lpad((floor(random() * 1000000))::int::text, 6, '0');
  v_hash := encode(digest(v_otp || 'ev_email_otp_2026', 'sha256'), 'hex');

  INSERT INTO "EV_EmailChangeOtps" (user_id, new_email, otp_hash, expires_at)
  VALUES (p_user_id, v_new_email, v_hash, NOW() + INTERVAL '10 minutes');

  RETURN v_otp;
END;
$$;

CREATE OR REPLACE FUNCTION verify_ev_email_change_otp(
  p_user_id UUID,
  p_new_email TEXT,
  p_otp TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_hash TEXT;
  v_row "EV_EmailChangeOtps"%ROWTYPE;
BEGIN
  v_hash := encode(digest(trim(p_otp) || 'ev_email_otp_2026', 'sha256'), 'hex');

  SELECT * INTO v_row
  FROM "EV_EmailChangeOtps"
  WHERE user_id = p_user_id
    AND lower(new_email) = lower(trim(p_new_email))
    AND otp_hash = v_hash
    AND expires_at > NOW()
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  DELETE FROM "EV_EmailChangeOtps" WHERE id = v_row.id;
  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION create_ev_email_change_otp(UUID, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION verify_ev_email_change_otp(UUID, TEXT, TEXT) TO anon, authenticated;
