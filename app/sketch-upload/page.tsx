// app/sketch-upload/page.tsx
//
// Upload page for sketches / drawings.
// - Reads quote_no from the URL (?quote_no=...)
// - Shows it on the page
// - Posts quote_no as a hidden field so /api/sketch-upload can link attachments
// - Lets the user add their email + choose a file (styled "button" area)

export const dynamic = "force-dynamic";

import React from "react";

type Props = {
  searchParams: { [key: string]: string | string[] | undefined };
};

export default function SketchUploadPage({ searchParams }: Props) {
  const raw = searchParams?.quote_no ?? searchParams?.quoteNo;
  const quoteNo = Array.isArray(raw) ? raw[0] : (raw || "");

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f3f4f6",
        fontFamily:
          "system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 520,
          background: "#ffffff",
          borderRadius: 16,
          padding: "24px 24px 24px 24px",
          boxShadow: "0 10px 30px rgba(15,23,42,0.08)",
        }}
      >
        <h1
          style={{
            margin: "0 0 8px 0",
            fontSize: 20,
            color: "#111827",
            fontWeight: 600,
          }}
        >
          Upload sketch or file
        </h1>

        <p
          style={{
            margin: "0 0 12px 0",
            fontSize: 13,
            color: "#4b5563",
          }}
        >
          You can upload a clear photo of your hand sketch, a PDF drawing, or
          screenshots of your layout. We&apos;ll use this to help dial in the
          dimensions and cavity details and send an updated quote.
        </p>

        {quoteNo && (
          <div
            style={{
              margin: "0 0 14px 0",
              fontSize: 13,
              color: "#111827",
            }}
          >
            Quote #{" "}
            <span
              style={{
                fontWeight: 600,
                padding: "2px 8px",
                borderRadius: 999,
                background: "#eff6ff",
                color: "#1d4ed8",
                border: "1px solid #bfdbfe",
              }}
            >
              {quoteNo}
            </span>
          </div>
        )}

        <form
          action="/api/sketch-upload"
          method="POST"
          encType="multipart/form-data"
          style={{ marginTop: 8 }}
        >
          {/* Hidden quote_no so the API can always link the attachment */}
          {quoteNo && (
            <input type="hidden" name="quote_no" value={quoteNo} />
          )}

          {/* Email field (optional but recommended) */}
          <label
            style={{
              display: "block",
              marginBottom: 4,
              fontSize: 13,
              color: "#111827",
              fontWeight: 500,
            }}
          >
            Your email address
          </label>
          <input
            type="email"
            name="email"
            placeholder="you@example.com"
            style={{
              width: "100%",
              padding: "8px 10px",
              borderRadius: 999,
              border: "1px solid #d1d5db",
              fontSize: 13,
              marginBottom: 14,
            }}
          />

          {/* File chooser styled as a button/area */}
          <label
            style={{
              display: "block",
              marginBottom: 4,
              fontSize: 13,
              color: "#111827",
              fontWeight: 500,
            }}
          >
            Sketch or drawing file
          </label>

          <div
            style={{
              position: "relative",
              marginBottom: 10,
              padding: "10px 14px",
              borderRadius: 12,
              border: "2px dashed #bfdbfe",
              background: "#eff6ff",
              cursor: "pointer",
            }}
          >
            <span
              style={{
                fontSize: 13,
                color: "#1d4ed8",
                fontWeight: 500,
              }}
            >
              Tap or click here to choose a file
            </span>
            <span
              style={{
                display: "block",
                fontSize: 11,
                color: "#4b5563",
                marginTop: 4,
              }}
            >
              JPG, PNG, or PDF — clear photos of sketches work great.
            </span>

            {/* The real file input is invisible but covers the blue box */}
            <input
              type="file"
              name="file"
              accept="image/*,application/pdf"
              required
              style={{
                position: "absolute",
                inset: 0,
                opacity: 0,
                cursor: "pointer",
              }}
            />
          </div>

          <button
            type="submit"
            style={{
              marginTop: 4,
              display: "inline-block",
              padding: "8px 18px",
              borderRadius: 999,
              background: "#1d4ed8",
              color: "#ffffff",
              fontSize: 13,
              fontWeight: 500,
              border: "1px solid #1d4ed8",
              cursor: "pointer",
            }}
          >
            Upload file
          </button>

          <p
            style={{
              margin: "10px 0 0 0",
              fontSize: 11,
              color: "#6b7280",
              lineHeight: 1.4,
            }}
          >
            By uploading, you confirm that you have the right to share this
            file and that it doesn&apos;t contain sensitive information you
            don&apos;t want on a quote.
          </p>
        </form>
      </div>
    </main>
  );
}
