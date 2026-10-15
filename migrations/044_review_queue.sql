-- 044_review_queue.sql
--
-- Step 32: the staff review queue (app/lib/review-queue.ts).
--   quotes.first_staff_view_at   when staff first opened the quote; a quote
--                                with none is "New, not opened". Existing
--                                quotes are marked as seen (their created_at)
--                                so the queue starts empty.
--   quote_queue_state            per quote: who it's assigned to, and a
--                                snooze date (hidden from the queue until then)
-- Idempotent.

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS first_staff_view_at timestamptz;

UPDATE public.quotes
   SET first_staff_view_at = COALESCE(created_at, now())
 WHERE first_staff_view_at IS NULL;

CREATE TABLE IF NOT EXISTS public.quote_queue_state (
  quote_id          bigint PRIMARY KEY,
  tenant_id         bigint,
  assigned_user_id  bigint,
  assigned_name     text,
  snoozed_until     timestamptz,
  updated_by        text,
  updated_at        timestamptz NOT NULL DEFAULT now()
);
