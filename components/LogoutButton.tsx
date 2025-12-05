// components/LogoutButton.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LogoutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    try {
      setLoading(true);
      await fetch("/api/auth/logout", { method: "POST" });
    } catch (err) {
      console.error("Logout failed:", err);
    } finally {
      setLoading(false);
      // Send them back to the login screen and clear any cached user state
      router.push("/login");
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className="rounded-full border border-neutral-700 px-3 py-1 text-xs text-neutral-200 hover:bg-neutral-800 disabled:opacity-60"
    >
      {loading ? "Logging out..." : "Log out"}
    </button>
  );
}
