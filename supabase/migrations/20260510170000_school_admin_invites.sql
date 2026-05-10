-- School admin invites: email-targeted, token-based, no transactional email.
--
-- An admin creates a row with the invitee's email; the row has a long random
-- token. The admin shares the resulting /invite/<token> link out-of-band
-- (text, email client, whatever). The invitee, once logged in with the
-- matching email address, calls accept_school_admin_invite(token) which adds
-- them to school_admins and stamps the row.
--
-- Two helper RPCs are also exposed:
--   list_school_admins(school_id) — admin-only; joins school_admins with
--                                   auth.users to expose email/display_name.
--   accept_school_admin_invite(token) — see above.

CREATE TABLE public.school_admin_invites (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  token       TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  role        TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('owner', 'admin')),
  invited_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '14 days'),
  accepted_at TIMESTAMPTZ,
  accepted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX school_admin_invites_school_pending_idx
  ON public.school_admin_invites (school_id)
  WHERE accepted_at IS NULL;

-- Only one pending invite per (school, email).
CREATE UNIQUE INDEX school_admin_invites_pending_unique
  ON public.school_admin_invites (school_id, lower(email))
  WHERE accepted_at IS NULL;

ALTER TABLE public.school_admin_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "invites manage by admins" ON public.school_admin_invites
  FOR ALL USING (public.is_school_admin(school_id))
  WITH CHECK (public.is_school_admin(school_id));

-- ---- Accept RPC ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.accept_school_admin_invite(p_token TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_email  TEXT;
  v_invite public.school_admin_invites;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'login required';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_caller;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'caller has no email on file';
  END IF;

  SELECT * INTO v_invite FROM public.school_admin_invites WHERE token = p_token;
  IF v_invite.id IS NULL THEN
    RAISE EXCEPTION 'invite not found';
  END IF;
  IF v_invite.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'invite already accepted';
  END IF;
  IF v_invite.expires_at < now() THEN
    RAISE EXCEPTION 'invite expired';
  END IF;
  IF lower(v_invite.email) <> lower(v_email) THEN
    RAISE EXCEPTION 'invite was issued for a different email';
  END IF;

  INSERT INTO public.school_admins (school_id, user_id, role)
    VALUES (v_invite.school_id, v_caller, v_invite.role)
    ON CONFLICT (school_id, user_id) DO UPDATE SET role = EXCLUDED.role;

  UPDATE public.school_admin_invites
    SET accepted_at = now(), accepted_by = v_caller
    WHERE id = v_invite.id;

  RETURN v_invite.school_id;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_school_admin_invite(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_school_admin_invite(TEXT) TO authenticated;

-- ---- List admins RPC -------------------------------------------------------

CREATE OR REPLACE FUNCTION public.list_school_admins(p_school UUID)
RETURNS TABLE (
  user_id      UUID,
  email        TEXT,
  display_name TEXT,
  role         TEXT,
  created_at   TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_school_admin(p_school) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  RETURN QUERY
    SELECT
      sa.user_id,
      u.email::TEXT,
      COALESCE(
        NULLIF(u.raw_user_meta_data->>'full_name', ''),
        NULLIF(u.raw_user_meta_data->>'name', ''),
        u.email
      )::TEXT,
      sa.role,
      sa.created_at
    FROM public.school_admins sa
    JOIN auth.users u ON u.id = sa.user_id
    WHERE sa.school_id = p_school
    ORDER BY sa.created_at;
END;
$$;

REVOKE ALL ON FUNCTION public.list_school_admins(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_school_admins(UUID) TO authenticated;
