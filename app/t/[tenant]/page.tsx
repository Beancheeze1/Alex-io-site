"use client";

import * as React from "react";
import { useParams } from "next/navigation";

export default function TenantLanding() {
  const params = useParams();
  const tenant = (params?.tenant || "").toString();

  const [theme, setTheme] = React.useState<any>(null);

  React.useEffect(() => {
    if (!tenant) return;

    fetch(`/api/tenant/theme?tenant=${tenant}&t=${Math.random()}`, {
      cache: "no-store",
    })
      .then((r) => r.json())
      .then((data) => {
        if (data?.ok && data?.theme_json) {
          setTheme(data.theme_json);

          document.documentElement.style.setProperty(
            "--tenant-primary",
            data.theme_json.primaryColor || "#0ea5e9",
          );
          document.documentElement.style.setProperty(
            "--tenant-secondary",
            data.theme_json.secondaryColor || "#6366f1",
          );
        }
      });
  }, [tenant]);

  if (!tenant) return null;

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-slate-950 text-white px-6">
      <div className="text-center max-w-xl">
        <div className="mb-6 text-sm uppercase tracking-widest opacity-60">
          Powered by Alex-IO
        </div>

        <h1
          className="text-4xl font-bold mb-4"
          style={{ color: "var(--tenant-primary)" }}
        >
          {theme?.brandName || tenant}
        </h1>

        <p className="mb-8 opacity-80">Start your custom packaging quote.</p>

        <a
          href={`/start-quote?tenant=${tenant}`}
          className="inline-block px-6 py-3 rounded-full font-semibold transition"
          style={{
            background: "var(--tenant-primary)",
            color: "white",
          }}
        >
          Start Quote
        </a>
      </div>
    </main>
  );
}
