// app/admin/website/page.tsx
//
// Step 38D: Shop settings → Website & chat widget. The shop's page address
// (to link from their own website) and the embed snippets (quote form,
// quote viewer, chat), moved here from the admin Home. Admins only.

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUserFromCookies } from "@/lib/auth";
import { resolveTenantFromHost } from "@/lib/tenant";
import EmbedSnippetCard, { buildEmbedHost } from "@/components/admin/EmbedSnippetCard";

export const dynamic = "force-dynamic";

export default async function WebsitePage() {
  const user = await getCurrentUserFromCookies();
  if (!user) redirect("/login?next=/admin/website");
  if (String(user.role || "").toLowerCase() !== "admin") redirect("/admin/quotes");

  let slug: string | null = null;
  let landingChatEnabled = false;
  try {
    const tenant = await resolveTenantFromHost((await headers()).get("host"));
    if (tenant) {
      slug = tenant.slug;
      landingChatEnabled = tenant.theme_json?.landingChatEnabled === true;
    }
  } catch {
    slug = null;
  }
  // Step 37L: a shop's page is the root of its own address.
  const shopUrl = slug ? (slug === "default" ? "https://api.alex-io.com/t/default" : `https://${buildEmbedHost(slug)}/`) : null;

  return (
    <main className="min-h-screen bg-[var(--surface-page)] text-[var(--text-primary)]">
      <div className="mx-auto max-w-4xl px-4 py-8 lg:py-10">
        <header className="mb-6 border-b border-[var(--border)] pb-5">
          <h1 className="text-2xl font-medium tracking-tight text-[var(--text-primary)]">Website &amp; chat widget</h1>
          <p className="mt-2 max-w-3xl text-sm text-[var(--text-secondary)]">
            Send buyers to your quote page from your own website: link to it with a &quot;Get a quote&quot; button, or
            paste a snippet to put the quote form or the chat right on your site.
          </p>
        </header>

        <section className="mb-6 rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-4" data-shop-page-link>
          <div className="mb-1 text-xs font-medium uppercase tracking-[0.18em] text-[var(--text-faint)]">Your quote page</div>
          {shopUrl ? (
            <>
              <a
                href={shopUrl}
                target="_blank"
                rel="noreferrer"
                className="break-all font-mono text-sm text-[var(--action-primary)] hover:underline"
              >
                {shopUrl}
              </a>
              <p className="mt-2 text-xs text-[var(--text-secondary)]">
                Link a &quot;Get a quote&quot; button on your website to this address. Sales reps&apos; own links are on
                Shop settings → Team &amp; users.
              </p>
            </>
          ) : (
            <p className="text-xs text-[var(--text-secondary)]">Couldn&apos;t find your shop&apos;s address. Reload this page to try again.</p>
          )}
        </section>

        <section data-embed>
          <EmbedSnippetCard tenantSlug={slug} landingChatEnabled={landingChatEnabled} />
        </section>
      </div>
    </main>
  );
}
