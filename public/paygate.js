/*!
 * PayGate popup SDK — public/paygate.js  (SPEC v3.1 §D, "Popup" integration mode)
 *
 * Opens the hosted pay page in an overlay iframe and relays its resolution back
 * to the embedding page. Vanilla, dependency-free, ES5-safe.
 *
 * Usage:
 *
 *   <script src="https://pay.paygate.app/paygate.js"></script>
 *   <script>
 *     PayGate.open({
 *       payUrl: "https://pay.paygate.app/pay/pi_123", // required
 *       onEvent: function (event, data, api) {          // required
 *         // event: "paid" | "needs_review" | "expired" | "closed"
 *         if (event === "paid") {
 *           // mark the order as "payment initiating", then redirect:
 *           location.assign("/thank-you?order=...");
 *         }
 *         if (event === "closed") {
 *           // the customer dismissed the window before it resolved
 *         }
 *       }
 *     });
 *   </script>
 *
 * IMPORTANT: a redirect or a postMessage event is NEVER proof of payment.
 * Fulfil orders from the `payment.paid` webhook or `GET /v1/payments/:id`; use
 * these events only for UX (closing the overlay, showing a pending state).
 *
 * Protocol: the pay page posts
 *   { source: "paygate-pay", event, payment_id, status }
 * to its parent. The SDK only accepts messages whose `event.source` is this
 * overlay's iframe and whose origin matches the `payUrl` origin.
 */
(function (global) {
  "use strict";

  var SOURCE = "paygate-pay";
  var VERSION = "3.1.0";
  var STYLE_ID = "paygate-popup-styles";
  var TRUSTED_EVENTS = { paid: 1, needs_review: 1, expired: 1, closed: 1 };

  /** Current session, or `null` when nothing is open. */
  var state = null;

  function injectStyles() {
    if (global.document.getElementById(STYLE_ID)) return;
    var style = global.document.createElement("style");
    style.id = STYLE_ID;
    style.textContent =
      ".pg-overlay{position:fixed;inset:0;z-index:2147483000;display:flex;" +
      "align-items:center;justify-content:center;padding:16px;" +
      "background:rgba(14,14,17,.6);-webkit-backdrop-filter:blur(2px);" +
      "backdrop-filter:blur(2px);animation:pg-fade .2s cubic-bezier(.2,.8,.2,1)}" +
      ".pg-frame-wrap{position:relative;width:100%;max-width:416px;height:100%;" +
      "max-height:720px;background:#fff;border-radius:16px;overflow:hidden;" +
      "box-shadow:0 12px 48px rgba(0,0,0,.28);" +
      "animation:pg-rise .2s cubic-bezier(.2,.8,.2,1)}" +
      ".pg-frame{display:block;width:100%;height:100%;border:0;background:#fff}" +
      ".pg-close{position:absolute;top:10px;right:10px;z-index:1;width:44px;" +
      "height:44px;display:inline-flex;align-items:center;justify-content:center;" +
      "border:1px solid rgba(14,14,17,.12);border-radius:9999px;" +
      "background:rgba(255,255,255,.92);color:#0E0E11;font-size:18px;line-height:1;" +
      "cursor:pointer;padding:0}" +
      ".pg-close:hover{background:#F4F4F2}" +
      ".pg-close:focus-visible{outline:2px solid #5B5BF0;outline-offset:2px}" +
      "@keyframes pg-fade{from{opacity:0}to{opacity:1}}" +
      "@keyframes pg-rise{from{opacity:0;transform:translateY(8px)}" +
      "to{opacity:1;transform:none}}" +
      "@media (prefers-reduced-motion: reduce){.pg-overlay,.pg-frame-wrap" +
      "{animation:none}.pg-overlay{-webkit-backdrop-filter:none;backdrop-filter:none}}";
    global.document.head.appendChild(style);
  }

  /** Origin of the pay page, used to validate inbound messages. */
  function resolveOrigin(url) {
    try {
      return new global.URL(url, global.location.href).origin;
    } catch {
      return "*";
    }
  }

  function onMessage(event) {
    if (!state) return;
    var data = event.data;
    if (!data || data.source !== SOURCE) return;
    // Reject spoofed / cross-window messages (SPEC v3.1 §D security).
    if (state.origin !== "*" && event.origin !== state.origin) return;
    if (event.source !== state.iframe.contentWindow) return;
    if (typeof data.event !== "string" || !TRUSTED_EVENTS[data.event]) return;
    settle(data.event, data);
  }

  function onKeydown(event) {
    if (event.key === "Escape" || event.keyCode === 27) dismiss();
  }

  /** Emit `name` to the caller and tear the overlay down. */
  function settle(name, data) {
    var session = state;
    if (!session) return;
    teardown();
    if (typeof session.onEvent === "function") {
      session.onEvent(name, data || { source: SOURCE, event: name }, api);
    }
  }

  /** The customer dismissed the window before the payment resolved. */
  function dismiss() {
    if (!state) return;
    settle("closed", {
      source: SOURCE,
      event: "closed",
      payment_id: state.paymentId,
    });
  }

  function teardown() {
    var session = state;
    state = null;
    global.removeEventListener("message", onMessage, false);
    global.document.removeEventListener("keydown", onKeydown, false);
    if (session.iframe.parentNode) {
      session.iframe.parentNode.removeChild(session.iframe);
    }
    if (session.overlay.parentNode) {
      session.overlay.parentNode.removeChild(session.overlay);
    }
    if (session.prevFocus && typeof session.prevFocus.focus === "function") {
      try {
        session.prevFocus.focus();
      } catch {
        /* the element may have been removed since; ignore. */
      }
    }
  }

  var api = {
    version: VERSION,
    open: function (options) {
      options = options || {};
      var payUrl = options.payUrl;
      if (!payUrl) {
        throw new Error("PayGate.open: 'payUrl' is required");
      }
      if (state) {
        // Already open: focus the existing window instead of stacking.
        if (typeof state.closeBtn.focus === "function") state.closeBtn.focus();
        return api;
      }

      injectStyles();

      var doc = global.document;
      var overlay = doc.createElement("div");
      overlay.className = "pg-overlay";
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-modal", "true");
      overlay.setAttribute("aria-label", "PayGate secure checkout");

      var wrap = doc.createElement("div");
      wrap.className = "pg-frame-wrap";

      var iframe = doc.createElement("iframe");
      iframe.className = "pg-frame";
      iframe.setAttribute("title", "PayGate secure checkout");
      iframe.setAttribute("allow", "clipboard-write");
      iframe.src = payUrl;

      var closeBtn = doc.createElement("button");
      closeBtn.type = "button";
      closeBtn.className = "pg-close";
      closeBtn.setAttribute("aria-label", "Close payment window");
      closeBtn.appendChild(doc.createTextNode("\u00D7"));

      wrap.appendChild(iframe);
      wrap.appendChild(closeBtn);
      overlay.appendChild(wrap);
      doc.body.appendChild(overlay);

      var paymentId = null;
      try {
        var segments = new global.URL(payUrl, global.location.href).pathname
          .split("/")
          .filter(Boolean);
        paymentId = segments[segments.length - 1] || null;
      } catch {
        paymentId = null;
      }

      state = {
        overlay: overlay,
        iframe: iframe,
        closeBtn: closeBtn,
        onEvent: options.onEvent,
        origin: resolveOrigin(payUrl),
        paymentId: paymentId,
        prevFocus: doc.activeElement,
      };

      global.addEventListener("message", onMessage, false);
      doc.addEventListener("keydown", onKeydown, false);

      if (typeof closeBtn.focus === "function") closeBtn.focus();

      overlay.addEventListener("click", function (event) {
        if (event.target === overlay) dismiss();
      });
      closeBtn.addEventListener("click", dismiss);

      return api;
    },
    close: function () {
      dismiss();
    },
    isOpen: function () {
      return state !== null;
    },
  };

  global.PayGate = global.PayGate || api;
})(typeof window !== "undefined" ? window : this);
