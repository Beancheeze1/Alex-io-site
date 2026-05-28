CREATE TABLE IF NOT EXISTS page_events (
  id           bigserial PRIMARY KEY,
  session_id   text NOT NULL,
  event_type   text NOT NULL,
  page         text NOT NULL DEFAULT '/landing',
  referrer     text,
  utm_source   text,
  utm_medium   text,
  utm_campaign text,
  device       text,
  ip           text,
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS page_events_created_at_idx  ON page_events (created_at DESC);
CREATE INDEX IF NOT EXISTS page_events_session_id_idx  ON page_events (session_id);
CREATE INDEX IF NOT EXISTS page_events_event_type_idx  ON page_events (event_type);
CREATE INDEX IF NOT EXISTS page_events_utm_source_idx  ON page_events (utm_source);
