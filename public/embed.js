/*!
 * Alex-IO embeddable widget loader.
 *
 * Quote form / quote viewer (placeholder-div convention):
 *
 *   <div data-alexio-embed data-tenant="YOUR-SLUG" data-mode="quote-form"></div>
 *   <script src="https://api.alex-io.com/embed.js" async></script>
 *
 * data-mode is "quote-form" or "quote-viewer". For "quote-viewer", also
 * set data-quote-no="Q-..." to point at a specific quote.
 *
 * Chat (no placeholder div — floats independent of document flow, corner-
 * pinned on the host page, same as the non-embedded chat bubble):
 *
 *   <script src="https://api.alex-io.com/embed.js" data-alexio-chat
 *           data-tenant="YOUR-SLUG" async></script>
 *
 * Generic across every tenant — the tenant slug always comes from a
 * data-tenant attribute (on the placeholder div, or on the chat script tag
 * itself), never hardcoded here.
 */
(function () {
  "use strict";

  // document.currentScript is only reliable during this script's own
  // synchronous top-level execution — by the time DOMContentLoaded (or any
  // other deferred callback) fires for an `async` script, it's back to
  // null. Capture it now, before any deferral, so the chat-mount path
  // (which reads data-tenant off THIS script tag) still works correctly.
  var thisScript = document.currentScript;

  var RESIZE_MESSAGE_TYPE = "alex-io-resize";
  var CHAT_STATE_MESSAGE_TYPE = "alex-io-chat-state";
  var DEFAULT_HEIGHT_PX = 480;
  var VALID_MODES = { "quote-form": true, "quote-viewer": true };

  // Chat's closed/open sizes are fixed, known constants (not content-driven
  // like form/viewer) — the bubble and panel don't grow with conversation
  // length, since the message list scrolls internally. "expanded" is the
  // one state that behaves like form/viewer: real content height, reported
  // via the same alex-io-resize message once the quote form mounts inside.
  var CHAT_SIZES = {
    closed: { width: "260px", height: "64px" },
    open: { width: "380px", height: "620px" },
    expanded: { width: "min(860px, calc(100vw - 40px))", height: DEFAULT_HEIGHT_PX + "px" },
  };

  function buildIframeSrc(tenant, mode, quoteNo) {
    // "default" is the core/root tenant slug (no subdomain prefix) — a
    // structural convention already used everywhere else in the app
    // (see lib/tenant.ts), not a specific customer's identity.
    var host = tenant === "default" ? "api.alex-io.com" : tenant + ".api.alex-io.com";
    var url = "https://" + host + "/embed/" + mode;
    if (mode === "quote-viewer" && quoteNo) {
      url += "?quote_no=" + encodeURIComponent(quoteNo);
    }
    return url;
  }

  function makeIframeId() {
    return "alexio-embed-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
  }

  // ---------- Quote form / quote viewer (placeholder-div) ----------

  function mountEmbed(el) {
    if (el.getAttribute("data-alexio-mounted") === "1") return;

    var tenant = (el.getAttribute("data-tenant") || "").trim();
    var mode = (el.getAttribute("data-mode") || "").trim();
    var quoteNo = (el.getAttribute("data-quote-no") || "").trim();

    if (!tenant) {
      if (window.console) console.error("[alexio-embed] Missing data-tenant on", el);
      return;
    }
    if (!VALID_MODES[mode]) {
      if (window.console) {
        console.error('[alexio-embed] data-mode must be "quote-form" or "quote-viewer" on', el);
      }
      return;
    }

    var iframe = document.createElement("iframe");
    iframe.src = buildIframeSrc(tenant, mode, quoteNo);
    iframe.setAttribute("data-alexio-iframe-id", makeIframeId());
    iframe.setAttribute("scrolling", "no");
    iframe.setAttribute("title", "Alex-IO " + mode);
    iframe.style.width = "100%";
    iframe.style.display = "block";
    iframe.style.border = "none";
    iframe.style.height = DEFAULT_HEIGHT_PX + "px";

    el.setAttribute("data-alexio-mounted", "1");
    el.appendChild(iframe);
  }

  function mountAllPlaceholderEmbeds() {
    var nodes = document.querySelectorAll("[data-alexio-embed]");
    for (var i = 0; i < nodes.length; i++) {
      mountEmbed(nodes[i]);
    }
  }

  // ---------- Chat (corner-pinned, no placeholder div) ----------

  function applyChatSize(iframe, sizeKey) {
    var size = CHAT_SIZES[sizeKey];
    if (!size) return;
    iframe.style.width = size.width;
    iframe.style.height = size.height;
  }

  function mountChat() {
    if (!thisScript) return;
    if (!thisScript.hasAttribute("data-alexio-chat")) return;
    if (thisScript.getAttribute("data-alexio-mounted") === "1") return;

    var tenant = (thisScript.getAttribute("data-tenant") || "").trim();
    if (!tenant) {
      if (window.console) console.error("[alexio-embed] Missing data-tenant on chat <script>");
      return;
    }

    var iframe = document.createElement("iframe");
    iframe.src = buildIframeSrc(tenant, "chat", null);
    iframe.setAttribute("data-alexio-iframe-id", makeIframeId());
    iframe.setAttribute("data-alexio-chat-iframe", "1");
    iframe.setAttribute("scrolling", "no");
    iframe.setAttribute("title", "Alex-IO chat");
    iframe.style.position = "fixed";
    iframe.style.bottom = "20px";
    iframe.style.right = "20px";
    iframe.style.border = "none";
    iframe.style.background = "transparent";
    iframe.style.colorScheme = "normal";
    iframe.style.zIndex = "2147483000";
    iframe.style.borderRadius = "16px";
    iframe.style.transition = "width 0.15s ease, height 0.15s ease";
    applyChatSize(iframe, "closed");
    iframe.setAttribute("allowtransparency", "true");

    thisScript.setAttribute("data-alexio-mounted", "1");
    document.body.appendChild(iframe);
  }

  // ---------- postMessage handling (shared) ----------

  function findIframeBySource(win) {
    var iframes = document.querySelectorAll("[data-alexio-iframe-id]");
    for (var i = 0; i < iframes.length; i++) {
      if (iframes[i].contentWindow === win) return iframes[i];
    }
    return null;
  }

  function onMessage(evt) {
    var data = evt.data;
    if (!data || typeof data !== "object") return;

    if (data.type === RESIZE_MESSAGE_TYPE && typeof data.height === "number") {
      var iframe = findIframeBySource(evt.source);
      if (iframe) {
        iframe.style.height = Math.max(1, Math.round(data.height)) + "px";
      }
      return;
    }

    if (data.type === CHAT_STATE_MESSAGE_TYPE && typeof data.state === "string") {
      var chatIframe = findIframeBySource(evt.source);
      if (!chatIframe) return;

      if (data.state === "disabled") {
        // Tenant hasn't opted into chat — render nothing rather than an
        // empty visible box.
        chatIframe.style.display = "none";
        return;
      }
      if (data.state === "closed" || data.state === "open" || data.state === "expanded") {
        applyChatSize(chatIframe, data.state);
      }
      return;
    }
  }

  window.addEventListener("message", onMessage);

  function mountAll() {
    mountAllPlaceholderEmbeds();
    mountChat();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountAll);
  } else {
    mountAll();
  }
})();
