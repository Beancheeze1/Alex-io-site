// lib/api-error.ts
import { NextResponse } from "next/server";
import logger from "./logger";

export function handleApiError(error: unknown, context = "unknown-route"): NextResponse {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  // Structured log — never leaks to the client in production
  logger.error(`API Error [${context}]`, {
    message,
    stack: process.env.NODE_ENV === "production" ? undefined : stack,
  });

  return NextResponse.json(
    {
      ok: false,
      error: message,
      // Stack only shown in development for debugging
      ...(process.env.NODE_ENV !== "production" && { stack }),
    },
    { status: 500 }
  );
}