/* Tiny UI toolkit shared by the company portal and the super-admin dashboard.
 * Everything is built with DOM APIs (never innerHTML) so user-supplied strings
 * such as company names can't inject markup. */
(function () {
  const UI = {};

  UI.h = function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === null || value === undefined || value === false) continue;
      if (key === "class") el.className = value;
      else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2), value);
      else if (key === "value" || key === "checked" || key === "disabled" || key === "selected") el[key] = value;
      else el.setAttribute(key, value === true ? "" : value);
    }
    const add = (child) => {
      if (Array.isArray(child)) child.forEach(add);
      else if (child === null || child === undefined || child === false) return;
      else el.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
    };
    children.forEach(add);
    return el;
  };
  const h = UI.h;

  UI.mount = function (root, ...nodes) {
    root.replaceChildren(...nodes.flat().filter(Boolean));
  };

  /* ---- API ---- */
  UI.api = async function api(path, opts) {
    opts = opts || {};
    const headers = { "X-Requested-With": "drawaid" };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(path, {
      method: opts.method || (opts.body !== undefined ? "POST" : "GET"),
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: "same-origin",
    });
    let data = null;
    try { data = await res.json(); } catch (_) { /* empty body */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || `Request failed (${res.status})`);
      err.status = res.status;
      err.data = data;
      if (res.status === 401 || (data && data.code === "ACCOUNT_BLOCKED")) {
        window.dispatchEvent(new CustomEvent("session-lost", { detail: err }));
      }
      throw err;
    }
    return data;
  };

  /* ---- Feedback ---- */
  let toastRoot;
  UI.toast = function (message, kind) {
    if (!toastRoot) {
      toastRoot = h("div", { class: "toasts", role: "status", "aria-live": "polite" });
      document.body.appendChild(toastRoot);
    }
    const t = h("div", { class: "toast" + (kind === "bad" ? " bad" : "") }, message);
    toastRoot.appendChild(t);
    setTimeout(() => t.remove(), 4200);
  };

  UI.modal = function ({ title, body, actions }) {
    const close = () => overlay.remove();
    const buttons = (actions || [{ label: "Close" }]).map((a) =>
      h(
        "button",
        {
          class: "btn " + (a.kind || ""),
          type: "button",
          onclick: async (e) => {
            if (a.onClick) {
              const btn = e.currentTarget;
              btn.disabled = true;
              try {
                const keepOpen = await a.onClick();
                if (keepOpen === false) { btn.disabled = false; return; }
              } catch (err) {
                btn.disabled = false;
                UI.toast(err.message, "bad");
                return;
              }
            }
            close();
          },
        },
        a.label
      )
    );
    const overlay = h(
      "div",
      { class: "overlay", onclick: (e) => e.target === overlay && close() },
      h("div", { class: "modal", role: "dialog", "aria-modal": "true" }, h("h2", {}, title), body, h("div", { class: "modal-actions" }, buttons))
    );
    document.body.appendChild(overlay);
    return close;
  };

  UI.copy = async function (text) {
    try {
      await navigator.clipboard.writeText(text);
      UI.toast("Copied to clipboard");
    } catch (_) {
      UI.toast("Copy failed - select and copy manually", "bad");
    }
  };

  UI.copyBox = function (text) {
    return h("div", { class: "copybox" }, h("code", {}, text), h("button", { class: "btn sm", type: "button", onclick: () => UI.copy(text) }, "Copy"));
  };

  UI.field = function (label, input, hint) {
    return h("label", { class: "field" }, h("span", {}, label), input, hint ? h("span", { class: "hint" }, hint) : null);
  };

  /* ---- Formatting ---- */
  UI.fmtDate = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "-");
  UI.fmtDay = (iso) => (iso ? new Date(iso).toLocaleDateString([], { dateStyle: "medium" }) : "-");
  UI.fmtNum = (n) => (n === null || n === undefined ? "-" : Number(n).toLocaleString());
  UI.fmtPct = (f) => (f === null || f === undefined ? "-" : Math.round(f * 100) + "%");
  UI.timeAgo = function (iso) {
    if (!iso) return "never";
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + " min ago";
    if (s < 86400) return Math.floor(s / 3600) + " h ago";
    if (s < 86400 * 30) return Math.floor(s / 86400) + " d ago";
    return UI.fmtDay(iso);
  };

  /* ---- Status presentation ---- */
  const STATUS = {
    PENDING: ["Waiting for customer", "warn", "neutral"],
    ID_UPLOADED: ["ID uploaded", "info", ""],
    VISUALLY_VERIFIED: ["Auto-check passed", "ok", "ok"],
    VISUALLY_REJECTED: ["Auto-check failed", "bad", "warn"],
    MANUALLY_VERIFIED: ["Approved", "ok", "ok"],
    MANUALLY_REJECTED: ["Rejected", "bad", "bad"],
    EXPIRED: ["Expired", "", "neutral"],
  };
  UI.STATUS_ORDER = Object.keys(STATUS);
  UI.statusLabel = (s) => (STATUS[s] ? STATUS[s][0] : s);
  UI.statusBadge = (s) => h("span", { class: "badge " + (STATUS[s] ? STATUS[s][1] : "") }, UI.statusLabel(s));

  UI.statusBars = function (byStatus) {
    const max = Math.max(1, ...Object.values(byStatus));
    return h(
      "div",
      { class: "status-list" },
      UI.STATUS_ORDER.map((s) =>
        h(
          "div",
          { class: "status-row" },
          h("span", {}, UI.statusLabel(s)),
          h("div", { class: "status-track" }, h("div", { class: "status-fill " + STATUS[s][2], style: `width:${((byStatus[s] || 0) / max) * 100}%` })),
          h("span", { class: "right muted" }, UI.fmtNum(byStatus[s] || 0))
        )
      )
    );
  };

  UI.stat = (label, value, foot) =>
    h("div", { class: "card stat" }, h("div", { class: "label" }, label), h("div", { class: "value" }, value), foot ? h("div", { class: "foot" }, foot) : null);

  /* ---- Bar chart (inline SVG, no dependencies) ---- */
  UI.barChart = function (daily, opts) {
    opts = opts || {};
    const W = 720, H = opts.height || 200, padL = 34, padR = 8, padT = 10, padB = 24;
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("class", "chart");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", opts.label || "Requests per day");
    const add = (name, attrs, text) => {
      const n = document.createElementNS(ns, name);
      for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v);
      if (text !== undefined) n.textContent = text;
      svg.appendChild(n);
      return n;
    };
    const rawMax = Math.max(0, ...daily.map((d) => d.count));
    const max = rawMax <= 4 ? 4 : Math.ceil(rawMax / 4) * 4;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    for (let i = 0; i <= 4; i++) {
      const y = padT + plotH - (plotH * i) / 4;
      add("line", { x1: padL, x2: W - padR, y1: y, y2: y, class: "grid-line" });
      add("text", { x: padL - 6, y: y + 4, "text-anchor": "end" }, Math.round((max * i) / 4));
    }
    const slot = plotW / daily.length, barW = Math.max(2, slot * 0.68);
    daily.forEach((d, i) => {
      const bh = (d.count / max) * plotH;
      const x = padL + i * slot + (slot - barW) / 2;
      const rect = add("rect", { x, y: padT + plotH - bh, width: barW, height: Math.max(bh, d.count ? 1 : 0), rx: 2, class: "bar" });
      const title = document.createElementNS(ns, "title");
      title.textContent = `${d.date}: ${d.count} request${d.count === 1 ? "" : "s"}`;
      rect.appendChild(title);
      if (i % Math.ceil(daily.length / 6) === 0 || i === daily.length - 1) {
        add("text", { x: x + barW / 2, y: H - 6, "text-anchor": "middle" }, d.date.slice(5));
      }
    });
    return svg;
  };

  UI.spinner = () => h("p", { class: "muted" }, "Loading…");

  window.UI = UI;
})();
