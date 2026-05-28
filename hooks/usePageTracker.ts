"use client";

import { useRef, useEffect } from "react";
import { useSearchParams } from "next/navigation";

function getOrCreateSessionId(): string {
  try {
    const existing = sessionStorage.getItem("alexio_sid");
    if (existing) return existing;
    const id = crypto.randomUUID();
    sessionStorage.setItem("alexio_sid", id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

function getDevice(): "mobile" | "desktop" {
  return window.innerWidth < 768 ? "mobile" : "desktop";
}

export function usePageTracker(page = "/landing") {
  const searchParams = useSearchParams();
  const firedRef = useRef<Set<string>>(new Set());
  const sessionRef = useRef<string | null>(null);

  const utmSource = searchParams.get("utm_source");
  const utmMedium = searchParams.get("utm_medium");
  const utmCampaign = searchParams.get("utm_campaign");

  function trackEvent(event_type: string) {
    if (firedRef.current.has(event_type)) return;
    firedRef.current.add(event_type);

    if (!sessionRef.current) return;

    const payload = JSON.stringify({
      session_id: sessionRef.current,
      event_type,
      page,
      referrer: document.referrer || null,
      utm_source: utmSource,
      utm_medium: utmMedium,
      utm_campaign: utmCampaign,
      device: getDevice(),
    });

    const url = "/api/track";
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([payload], { type: "application/json" }));
    } else {
      fetch(url, {
        method: "POST",
        body: payload,
        headers: { "Content-Type": "application/json" },
        keepalive: true,
      }).catch(() => {});
    }
  }

  // Initialize session and fire page_view on mount
  useEffect(() => {
    sessionRef.current = getOrCreateSessionId();
    trackEvent("page_view");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Passive scroll listener — fires scroll_50 once, then removes itself
  useEffect(() => {
    function onScroll() {
      if (window.scrollY + window.innerHeight >= document.body.scrollHeight * 0.5) {
        trackEvent("scroll_50");
        window.removeEventListener("scroll", onScroll);
      }
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { trackEvent };
}
