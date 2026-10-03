// components/tenant/TenantLogo.tsx
//
// Tenant logo with a visible fallback if the admin-entered URL is broken.
"use client";

import * as React from "react";

export default function TenantLogo({
  src,
  alt,
  fallback,
}: {
  src: string;
  alt: string;
  fallback: React.ReactNode;
}) {
  const [failed, setFailed] = React.useState(false);
  if (!src || failed) return <>{fallback}</>;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className="h-11 w-auto max-w-[220px] object-contain"
      onError={() => setFailed(true)}
    />
  );
}
