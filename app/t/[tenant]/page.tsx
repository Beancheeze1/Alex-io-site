"use client";

import * as React from "react";
import { useParams, useSearchParams } from "next/navigation";
import SplashChatWidget from "@/components/SplashChatWidget";

export default function TenantLanding() {
  const params = useParams();
  const searchParams = useSearchParams();
  const tenant = (params?.tenant || "").toString();

  const salesRepSlug = searchParams?.get("sales_rep_slug")?.trim() || "";

  // Build the path the chatbot will push to when the customer completes intake.
  // Include sales_rep_slug if present so the quote gets attributed to the rep.
  const startQuotePath = salesRepSlug
    ? `/start-quote?tenant=${tenant}&sales_rep_slug=${encodeURIComponent(salesRepSlug)}`
    : `/start-quote?tenant=${tenant}`;

  const [theme, setTheme] = React.useState<any>(null);
  const [logoFailed, setLogoFailed] = React.useState(false);

  React.useEffect(() => {
    if (!tenant) return;

    fetch(`/api/tenant/theme?tenant=${tenant}&t=${Math.random()}`, {
      cache: "no-store",
    })
      .then((r) => r.json())
      .then((data) => {
        if (data?.ok && data?.theme_json) {
          setTheme(data.theme_json);
          setLogoFailed(false);

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

  const brandName = (theme?.brandName || tenant || "").toString();
  const logoUrl = typeof theme?.logoUrl === "string" ? theme.logoUrl.trim() : "";
  const heroUseLogo = theme?.heroUseLogo === true;

  const showLogo = heroUseLogo && !!logoUrl && !logoFailed;

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-slate-950 text-white px-6">
      <div className="text-center max-w-xl">
        <div className="mb-6 text-sm uppercase tracking-widest opacity-60">
          Powered by Alex-IO
        </div>

        {showLogo ? (
          <div className="mb-4 flex items-center justify-center">
            <img
              src={logoUrl}
              alt={brandName}
              className="h-16 w-auto max-w-[320px] object-contain"
              onError={() => setLogoFailed(true)}
            />
          </div>
        ) : (
          <h1
            className="text-4xl font-bold mb-4"
            style={{ color: "var(--tenant-primary)" }}
          >
            {brandName}
          </h1>
        )}

        <p className="mb-8 opacity-80">Start your custom packaging quote.</p>

        <a
          href={startQuotePath}
          className="inline-block px-6 py-3 rounded-full font-semibold transition"
          style={{
            background: "var(--tenant-primary)",
            color: "white",
          }}
        >
          Start Quote
        </a>

        {/* Optional: if logo was enabled but failed, we silently fall back to text */}
      </div>
      {theme?.landingChatEnabled ? (
        <SplashChatWidget startQuotePath={startQuotePath} />
      ) : null}
    </main>
  );
}
