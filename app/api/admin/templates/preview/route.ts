// app/api/admin/templates/preview/route.ts
//
// Relocated from app/api/admin/templates/route.ts (GET), which is now the
// CRUD list endpoint for the `templates` table. This is unchanged logic —
// a diagnostic that renders a sample email using the active mail template
// and signature, useful for confirming the mail-render pipeline works.

import { NextRequest, NextResponse } from "next/server";

import { pickTemplateWithKey } from "@/app/lib/templates";
import { pickSignature } from "@/app/lib/signature";
import { renderTemplate } from "@/app/lib/tpl";
import { shouldWrap, wrapHtml } from "@/app/lib/layout";
import { adminOnly } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

function mustStr(v: string | undefined, fb = ""): string {
  return v ?? fb;
}

function pickTemplateSafe(inboxEmail: string) {
  try {
    // @ts-expect-error object overload allowed
    return pickTemplateWithKey({ inboxEmail }) ?? pickTemplateWithKey(inboxEmail);
  } catch {
    try {
      // @ts-expect-error string overload allowed
      return pickTemplateWithKey(inboxEmail);
    } catch {
      return { subject: "[Alex-IO]", html: "{{body}}" };
    }
  }
}

function pickSignatureSafe(inboxEmail: string) {
  try {
    // @ts-expect-error object overload allowed
    return pickSignature({ inboxEmail }) ?? pickSignature(inboxEmail);
  } catch {
    try {
      // @ts-expect-error string overload allowed
      return pickSignature(inboxEmail);
    } catch {
      return { key: "(fallback)", html: "" };
    }
  }
}

export const GET = adminOnly(async (_req: NextRequest) => {
  const inboxEmail = String(process.env.MS_MAILBOX_FROM || "sales@alex-io.com").toLowerCase();
  const templ = pickTemplateSafe(inboxEmail);
  const sig = pickSignatureSafe(inboxEmail);

  const subject = mustStr((templ as any)?.subject, "[Alex-IO]");
  const htmlTmpl = mustStr((templ as any)?.html, "{{body}}");

  const sample = renderTemplate(htmlTmpl, { body: "Template OK" });
  const composed = sample + mustStr(sig?.html, "");

  // ✅ object form to satisfy Partial<WrapOpts>
  const wrapped = shouldWrap() ? wrapHtml({ subject, html: composed }) : composed;

  return NextResponse.json({
    ok: true,
    inboxEmail,
    template: { subject, html: htmlTmpl },
    signature: { key: sig?.key ?? "(fallback)", html: mustStr(sig?.html, "") },
    preview: { subject, html: wrapped },
  });
});
