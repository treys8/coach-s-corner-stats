-- Self-serve signup: SECURITY DEFINER function that atomically creates a school
-- and grants the calling user owner-level admin access.
--
-- Without this, a freshly-signed-up user can't insert into `schools` (RLS gates
-- writes on `is_school_admin`, but they're not admin yet) or into `school_admins`
-- (same chicken-and-egg). The function bypasses RLS for the bootstrap and is
-- callable only by authenticated users.

CREATE OR REPLACE FUNCTION public.create_school(p_slug TEXT, p_name TEXT)
RETURNS public.schools
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_school public.schools;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  INSERT INTO public.schools (slug, name)
  VALUES (p_slug, p_name)
  RETURNING * INTO v_school;

  INSERT INTO public.school_admins (school_id, user_id, role)
  VALUES (v_school.id, v_user_id, 'owner');

  RETURN v_school;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_school(TEXT, TEXT) TO authenticated;
