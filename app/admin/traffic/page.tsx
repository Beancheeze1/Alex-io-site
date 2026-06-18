import { redirect } from "next/navigation";
import { getCurrentUserFromCookies } from "@/lib/auth";
import { q } from "@/lib/db";
import TrafficClient from "./TrafficClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type FunnelRow = {
  event_type: string;
  sessions: number;
};

export type DailyRow = {
  day: string;
  page_views: number;
  cta_clicks: number;
  form_submits: number;
};

export type SourceRow = {
  source: string;
  sessions: number;
  cta_clicks: number;
  form_submits: number;
};

export type SessionRow = {
  session_id: string;
  first_seen: string;
  last_seen: string;
  device: string | null;
  utm_source: string | null;
  referrer: string | null;
  events: string;
  converted: boolean;
  engaged: boolean;
  city: string | null;
  region: string | null;
};

export type TrafficData = {
  days: number;
  funnel: FunnelRow[];
  daily: DailyRow[];
  sources: SourceRow[];
  sessions: SessionRow[];
};

type Props = {
  searchParams: Promise<{ days?: string }>;
};

export default async function TrafficPage({ searchParams }: Props) {
  const user = await getCurrentUserFromCookies();
  if (!user || user.role !== "admin") redirect("/login");

  const sp = await searchParams;
  const daysRaw = Number(sp?.days ?? 30);
  const days = ([7, 30, 90] as const).includes(daysRaw as 7 | 30 | 90)
    ? (daysRaw as 7 | 30 | 90)
    : 30;

  const [funnel, daily, sources, sessions] = await Promise.all([
    q<FunnelRow>(
      `SELECT event_type,
              COUNT(DISTINCT session_id)::int AS sessions
       FROM page_events
       WHERE created_at >= now() - ($1 || ' days')::interval
       GROUP BY event_type
       ORDER BY sessions DESC`,
      [days],
    ),

    q<DailyRow>(
      `SELECT DATE_TRUNC('day', created_at)::date::text AS day,
              COUNT(DISTINCT session_id) FILTER (WHERE event_type = 'page_view')::int  AS page_views,
              COUNT(DISTINCT session_id) FILTER (WHERE event_type = 'cta_click')::int  AS cta_clicks,
              COUNT(DISTINCT session_id) FILTER (WHERE event_type = 'form_submit')::int AS form_submits
       FROM page_events
       WHERE created_at >= now() - ($1 || ' days')::interval
       GROUP BY day
       ORDER BY day ASC`,
      [days],
    ),

    q<SourceRow>(
      `SELECT COALESCE(
               NULLIF(utm_source,''),
               NULLIF(
                 CASE WHEN referrer ~ 'alex-io\\.com' THEN NULL ELSE referrer END,
                 ''
               ),
               'direct'
             ) AS source,
             COUNT(DISTINCT session_id)::int AS sessions,
             COUNT(DISTINCT session_id) FILTER (WHERE event_type = 'cta_click')::int AS cta_clicks,
             COUNT(DISTINCT session_id) FILTER (
               WHERE event_type IN ('form_submit','quote_applied','quote_email')
             )::int AS form_submits
       FROM page_events
       WHERE created_at >= now() - ($1 || ' days')::interval
       GROUP BY source
       ORDER BY sessions DESC`,
      [days],
    ),

    q<SessionRow>(
      `SELECT session_id,
              MIN(created_at)::text AS first_seen,
              MAX(created_at)::text AS last_seen,
              MAX(device)           AS device,
              MAX(utm_source)       AS utm_source,
              MAX(
                CASE
                  WHEN referrer ~ 'alex-io\\.com' THEN NULL
                  ELSE referrer
                END
              ) AS referrer,
              MAX(city)   AS city,
              MAX(region) AS region,
              STRING_AGG(DISTINCT event_type, ',' ORDER BY event_type) AS events,
              BOOL_OR(event_type IN ('form_submit','quote_applied','quote_email')) AS converted,
              BOOL_OR(event_type = 'form_start') AND NOT BOOL_OR(event_type IN ('form_submit','quote_applied','quote_email')) AS engaged
       FROM page_events
       WHERE created_at >= now() - ($1 || ' days')::interval
       GROUP BY session_id
       ORDER BY MAX(created_at) DESC
       LIMIT 200`,
      [days],
    ),
  ]);

  const data: TrafficData = { days, funnel, daily, sources, sessions };

  return <TrafficClient data={data} />;
}
