-- 047_onboarding_invites.sql
--
-- Step 36A: shop onboarding.
--   user_invites        one-time links to set a password: "invite" (7 days,
--                       new users) and "reset" (1 hour, forgot password).
--                       Only a SHA-256 of the token is stored.
--   tenant_onboarding   checklist steps a shop marked done by hand (steps
--                       the app can't see for itself, e.g. the widget is on
--                       their website)
-- Idempotent.

CREATE TABLE IF NOT EXISTS public.user_invites (
  id          bigserial PRIMARY KEY,
  user_id     bigint NOT NULL,
  tenant_id   bigint NOT NULL,
  kind        text NOT NULL DEFAULT 'invite',
  token_hash  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_by  text
);

CREATE UNIQUE INDEX IF NOT EXISTS user_invites_token_idx ON public.user_invites (token_hash);
CREATE INDEX IF NOT EXISTS user_invites_user_idx ON public.user_invites (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.tenant_onboarding (
  tenant_id  bigint NOT NULL,
  step       text NOT NULL,
  done_at    timestamptz NOT NULL DEFAULT now(),
  done_by    text,
  PRIMARY KEY (tenant_id, step)
);
