// app/quote/start/page.tsx
//
// Public landing page for rep-specific quote links.
// Example: /quote/start?rep=chuck
// - Shows the rep slug (if present)
// - Provides a button that opens the user's email client to email sales@alex-io.com
//   with a subject tagging the rep, so the bot can attribute the quote later.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
};

export default async function QuoteStartPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const repParam = sp?.rep;
  const rep =
    Array.isArray(repParam) && repParam.length > 0
      ? repParam[0]
      : typeof repParam === "string"
      ? repParam
      : null;

  const safeRep = rep?.trim() || null;

  const subjectBase = "Packaging Quote Request";
  const subject = safeRep ? `${subjectBase} [${safeRep}]` : subjectBase;

  const bodyLines = [
    "Hi, I'd like a packaging quote.",
    "",
    "Product details:",
    "- Product name:",
    "- Approx. size & weight:",
    "- Fragility / handling notes:",
    "",
    "Anything else you should know:",
    "",
    safeRep ? `(This request came from rep link: ${safeRep})` : "",
  ];

  const mailtoHref = `mailto:sales@alex-io.com?subject=${encodeURIComponent(
    subject,
  )}&body=${encodeURIComponent(bodyLines.join("\n"))}`;

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--surface-page)] px-4">
      <div className="max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] px-6 py-8 text-[var(--text-primary)] shadow-sm">
        <h1 className="mb-3 text-xl font-medium tracking-tight text-[var(--text-primary)]">
          Start your Alex-IO quote
        </h1>
        <p className="mb-4 text-sm text-[var(--text-secondary)]">
          You&apos;re just one email away from a foam packaging quote generated
          by the Alex-IO bot.
        </p>

        {safeRep && (
          <p className="mb-4 text-xs text-[var(--text-secondary)]">
            You&apos;re currently working with{" "}
            <span className="font-medium">@{safeRep}</span>. Your request will
            be tagged to their seat.
          </p>
        )}

        <p className="mb-6 text-xs text-[var(--text-muted)]">
          Click the button below to open an email to{" "}
          <span className="font-mono">sales@alex-io.com</span> with a pre-filled
          subject line. Add your product details and send it—Alex-IO will do the
          rest.
        </p>

        <a
          href={mailtoHref}
          className="inline-flex w-full items-center justify-center rounded-md bg-[var(--action-primary)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--action-primary-hover)]"
        >
          Open email to sales@alex-io.com
        </a>

        <p className="mt-4 text-[11px] text-[var(--text-faint)]">
          If the button doesn&apos;t work, you can also email{" "}
          <span className="font-mono">sales@alex-io.com</span> directly and
          mention{" "}
          {safeRep ? (
            <>
              <span className="font-mono">[{safeRep}]</span> in the subject line.
            </>
          ) : (
            "the rep code you were given in the subject line."
          )}
        </p>
      </div>
    </main>
  );
}
