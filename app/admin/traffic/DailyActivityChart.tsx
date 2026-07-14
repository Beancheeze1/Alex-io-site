"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import type { DailyRow } from "./page";

// recharts' ResponsiveContainer measures its container via browser-only APIs,
// so it cannot produce matching output during SSR. This component is loaded
// with ssr: false from TrafficClient to avoid the resulting hydration
// mismatch (React error #418) instead of fighting it with placeholder sizing.
export default function DailyActivityChart({
  daily,
  colors,
}: {
  daily: DailyRow[];
  colors: { page_view: string; cta_click: string; form_submit: string };
}) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={daily} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E4E4E0" />
        <XAxis dataKey="day" tick={{ fill: "#7A7A74", fontSize: 11 }} />
        <YAxis tick={{ fill: "#7A7A74", fontSize: 11 }} />
        <Tooltip
          contentStyle={{
            backgroundColor: "#FFFFFF",
            border: "1px solid #E4E4E0",
            borderRadius: 8,
          }}
          labelStyle={{ color: "#1C1C1A" }}
          itemStyle={{ color: "#1C1C1A" }}
        />
        <Legend wrapperStyle={{ fontSize: 11, color: "#7A7A74" }} />
        <Line
          type="monotone"
          dataKey="page_views"
          stroke={colors.page_view}
          dot={false}
          strokeWidth={2}
        />
        <Line
          type="monotone"
          dataKey="cta_clicks"
          stroke={colors.cta_click}
          dot={false}
          strokeWidth={2}
        />
        <Line
          type="monotone"
          dataKey="form_submits"
          stroke={colors.form_submit}
          dot={false}
          strokeWidth={2}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
