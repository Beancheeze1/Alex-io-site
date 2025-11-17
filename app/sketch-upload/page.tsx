// app/sketch-upload/page.tsx
import React from "react";

type Props = {
  searchParams: { [key: string]: string | string[] | undefined };
};

export default function SketchUploadPage({ searchParams }: Props) {
  const raw = searchParams?.quote_no;
  const quoteNo = Array.isArray(raw) ? raw[0] : raw || "";

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
        {quoteNo && (
          <p
            style={{
              margin: "0 0 12px 0",
              fontSize: 13,
              color: "#4b5563",
            }}
          >
            For quote{" "}
            <span style={{ fontWeight: 600 }}>#{quoteNo}</span>
          </p>
        )}

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

        <form
          action="/api/sketch-upload"
          method="POST"
          encType="multipart/form-data"
          style={{ marginTop: 8 }}
        >
          {quoteNo && (
            <input type="hidden" name="quote_no" value={quoteNo} />
          )}

          {/* Email field */}
          <div style={{ marginBottom: 12 }}>
            <label
              htmlFor="upload-email"
              style={{
                display: "block",
                fontSize: 13,
                color: "#374151",
                marginBottom: 4,
                fontWeight: 500,
              }}
            >
              Your email address
            </label>
            <input
              id="upload-email"
              type="email"
              name="email"
              placeholder="you@example.com"
              required
              style={{
                width: "100%",
                fontSize: 13,
                padding: "7px 10px",
                borderRadius: 999,
                border: "1px solid #d1d5db",
                outline: "none",
              }}
            />
          </div>

          {/* File picker – styled like a button */}
          <div style={{ marginBottom: 12 }}>
            <label
              htmlFor="upload-file"
              style={{
                display: "block",
                fontSize: 13,
                color: "#374151",
                marginBottom: 4,
                fontWeight: 500,
              }}
            >
              Sketch or drawing file
            </label>
            <input
              id="upload-file"
              type="file"
              name="file"
              accept="image/*,application/pdf"
              required
              style={{
                display: "block",
                width: "100%",
                fontSize: 13,
                padding: "8px 10px",
                borderRadius: 999,
                border: "1px dashed #93c5fd",
                background: "#eff6ff",
                cursor: "pointer",
              }}
            />
            <p
              style={{
                margin: "6px 0 0 0",
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
