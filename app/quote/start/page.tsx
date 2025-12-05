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
  searchParams?: { [key: string]: string | string[] | undefined };
};

export default function QuoteStartPage({ searchParams }: PageProps) {
  const repParam = searchParams?.rep;
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
    <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-4">
      <div className="max-w-lg rounded-2xl bg-neutral-900 px-6 py-8 text-neutral-50 shadow-xl">
        <h1 className="mb-3 text-xl font-semibold tracking-tight text-sky-300">
          Start your Alex-IO quote
        </h1>
        <p className="mb-4 text-sm text-neutral-200">
          You&apos;re just one email away from a foam packaging quote generated
          by the Alex-IO bot.
        </p>

        {safeRep && (
          <p className="mb-4 text-xs text-neutral-300">
            You&apos;re currently working with{" "}
            <span className="font-semibold">@{safeRep}</span>. Your request will
            be tagged to their seat.
          </p>
        )}

        <p className="mb-6 text-xs text-neutral-400">
          Click the button below to open an email to{" "}
          <span className="font-mono">sales@alex-io.com</span> with a pre-filled
          subject line. Add your product details and send it—Alex-IO will do the
          rest.
        </p>

        <a
          href={mailtoHref}
          className="inline-flex w-full items-center justify-center rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-400"
        >
          Open email to sales@alex-io.com
        </a>

        <p className="mt-4 text-[11px] text-neutral-500">
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
