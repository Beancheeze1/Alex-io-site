-- 043_quote_proofs.sql
--
-- Step 31: artwork proofs. The shop uploads a proof (v1, v2, ...), the buyer
-- approves it or asks for changes (app/lib/proofs.ts).
--   attachment_id           the proof file (quote_attachments, kind 'proof')
--   status                  sent | approved | changes | superseded
--   response_*              the buyer's answer (or staff recording an approval
--                           for them: response_by_staff); a marked-up file is
--                           a quote_attachments row, kind 'proof_markup'
-- Idempotent.

CREATE TABLE IF NOT EXISTS public.quote_proofs (
  id                      bigserial PRIMARY KEY,
  quote_id                bigint NOT NULL,
  tenant_id               bigint,
  version                 integer NOT NULL,
  attachment_id           bigint NOT NULL,
  note                    text,
  status                  text NOT NULL DEFAULT 'sent',
  sent_by                 text,
  sent_at                 timestamptz NOT NULL DEFAULT now(),
  response_at             timestamptz,
  response_name           text,
  response_comment        text,
  response_attachment_id  bigint,
  response_by_staff       boolean NOT NULL DEFAULT false,
  CONSTRAINT quote_proofs_quote_version_key UNIQUE (quote_id, version)
);

CREATE INDEX IF NOT EXISTS quote_proofs_quote_idx ON public.quote_proofs (quote_id, version DESC);
