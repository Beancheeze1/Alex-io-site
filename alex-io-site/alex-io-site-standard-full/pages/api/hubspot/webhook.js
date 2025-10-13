import { postMessageToThread } from "@/lib/hubspot";

const AUTO_COMMENT = String(process.env.AUTO_COMMENT || "false").toLowerCase() === "true";

export default async function handler(req, res) {
  if (req.method === "GET") {
    console.log("[webhook][GET] /api/hubspot/webhook");
    return res.status(200).json({ ok: true, path: "/api/hubspot/webhook" });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  try {
    const raw = await new Promise((resolve, reject) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      req.on("error", reject);
    });

    console.log("[webhook][POST] raw preview:", (raw || "").slice(0, 500));

    let events = [];
    try { events = JSON.parse(raw); } catch {}

    if (Array.isArray(events)) {
      for (const e of events) {
        const type = e?.subscriptionType;
        const threadId = e?.objectId;
        const msgType = e?.messageType;
        const change  = e?.changeFlag;

        console.log("[webhook] event:", { type, threadId, msgType, change });

        const isNewInbound =
          type === "conversation.newMessage" &&
          (msgType === "MESSAGE" || !msgType) &&
          (change === "NEW_MESSAGE" || !change);

        if (!isNewInbound || !threadId) continue;

        if (AUTO_COMMENT) {
          try {
            await postMessageToThread(threadId, "Thanks for your message — we’ll be in touch soon!");
            console.log("✅ posted auto-comment (thread):", threadId);
          } catch (err) {
            console.error("❌ HubSpot post failed:", err?.message);
          }
        }
      }
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[webhook] fatal:", err?.message);
    return res.status(200).json({ ok: false, error: err?.message ?? "unknown" });
  }
}

