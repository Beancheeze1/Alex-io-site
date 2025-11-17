// app/sketch-upload/page.tsx
"use client";

import React from "react";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: { [key: string]: string | string[] | undefined };
};

export default function SketchUploadPage({ searchParams }: Props) {
  // Try to get an initial value from server-side searchParams
  const raw = searchParams?.quote_no;
  const initialFromServer = Array.isArray(raw) ? raw[0] : raw || "";

  const [quoteNo, setQuoteNo] = React.useState(initialFromServer);

  // On the client, also read from window.location in case anything was missed
  React.useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const fromUrl = params.get("quote_no");
      if (fromUrl && fromUrl !== quoteNo) {
        setQuoteNo(fromUrl);
      }
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          maxWidth: 480,
          background: "#ffffff",
          borderRadius: 16,
          padding: "24px 24px 20px 24px",
          boxShadow: "0 10px 30px rgba(15,23,42,0.08)",
        }}
      >
        <h1
          style={{
            margin: "0 0 8px 0",
            fontSize: 18,
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
          dimensions and cavity details.
        </p>

        <form
          action="/api/sketch-upload"
          method="POST"
          encType="multipart/form-data"
          style={{ marginTop: 8 }}
        >
          {/* Quote number field (required, auto-filled from URL, but editable) */}
          <div style={{ marginBottom: 12 }}>
            <label
              htmlFor="quote_no"
              style={{
                display: "block",
                marginBottom: 4,
                fontSize: 12,
                color: "#4b5563",
                fontWeight: 500,
              }}
            >
              Quote number
            </label>
            <input
              id="quote_no"
              name="quote_no"
              type="text"
              value={quoteNo}
              onChange={(e) => setQuoteNo(e.target.value)}
              required
              placeholder="e.g. Q-AI-20251116-223023"
              style={{
                display: "block",
                width: "100%",
                borderRadius: 8,
                border: "1px solid #d1d5db",
                fontSize: 13,
                padding: "6px 10px",
                color: "#111827",
                boxSizing: "border-box",
              }}
            />
          </div>

          {/* NEW: email field */}
          <div style={{ marginBottom: 12 }}>
            <label
              htmlFor="email"
              style={{
                display: "block",
                marginBottom: 4,
                fontSize: 12,
                color: "#4b5563",
                fontWeight: 500,
              }}
            >
              Your email address
            </label>
            <input
              id="email"
              name="email"
              type="email"
              placeholder="you@example.com"
              style={{
                display: "block",
                width: "100%",
                borderRadius: 999,
                border: "1px solid #d1d5db",
                fontSize: 13,
                padding: "8px 10px",
                color: "#111827",
                boxSizing: "border-box",
              }}
            />
          </div>

          {/* File chooser styled as blue clickable area */}
          <div style={{ marginBottom: 12 }}>
            <label
              htmlFor="file"
              style={{
                display: "block",
                marginBottom: 4,
                fontSize: 12,
                color: "#4b5563",
                fontWeight: 500,
              }}
            >
              Sketch or drawing file
            </label>

            <div
              style={{
                position: "relative",
                marginBottom: 4,
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

              {/* Invisible real file input covering the blue area */}
              <input
                id="file"
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

            <p
              style={{
                margin: "2px 0 0 0",
                fontSize: 11,
                color: "#6b7280",
              }}
            >
              Tap or click the blue bar above to choose a file.
            </p>
          </div>

          <button
            type="submit"
            style={{
              marginTop: 4,
              display: "inline-block",
              padding: "8px 14px",
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
