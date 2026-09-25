(function () {
  const { h, api, mount, toast, field } = UI;
  const root = document.getElementById("app");
  const state = { me: null, config: { brandName: "DRAWAID", signupEnabled: true, baseUrl: location.origin } };
  let timer = null;

  const stopTimer = () => { if (timer) { clearInterval(timer); timer = null; } };
  const poll = (fn, ms) => { stopTimer(); timer = setInterval(fn, ms); };

  /* ------------------------------------------------------------------ auth */
  function renderAuth(initialTab, notice) {
    let tab = initialTab || "login";
    const box = h("div");
    const draw = () => {
      const tabs = h(
        "div",
        { class: "tabs" },
        h("button", { class: tab === "login" ? "active" : "", type: "button", onclick: () => { tab = "login"; draw(); } }, "Sign in"),
        state.config.signupEnabled
          ? h("button", { class: tab === "signup" ? "active" : "", type: "button", onclick: () => { tab = "signup"; draw(); } }, "Register company")
          : null
      );
      mount(box, tabs, tab === "login" ? loginForm() : signupForm());
    };

    const loginForm = () => {
      const email = h("input", { type: "email", autocomplete: "username", required: true });
      const password = h("input", { type: "password", autocomplete: "current-password", required: true });
      const err = h("div", { class: "notice bad hidden" });
      return h(
        "form",
        {
          onsubmit: async (e) => {
            e.preventDefault();
            err.classList.add("hidden");
            try {
              const { business } = await api("/portal/api/login", { body: { email: email.value, password: password.value } });
              state.me = business;
              location.hash = "#/";
              route();
            } catch (ex) {
              err.textContent = ex.message;
              err.classList.remove("hidden");
            }
          },
        },
        err,
        field("Work email", email),
        field("Password", password),
        h("button", { class: "btn primary", style: "width:100%;justify-content:center", type: "submit" }, "Sign in")
      );
    };

    const signupForm = () => {
      const name = h("input", { type: "text", autocomplete: "organization", required: true, minlength: 2, maxlength: 100 });
      const email = h("input", { type: "email", autocomplete: "username", required: true });
      const password = h("input", { type: "password", autocomplete: "new-password", required: true, minlength: 10 });
      const webhook = h("input", { type: "url", placeholder: "https://yourapp.com/drawaid-webhook" });
      const err = h("div", { class: "notice bad hidden" });
      return h(
        "form",
        {
          onsubmit: async (e) => {
            e.preventDefault();
            err.classList.add("hidden");
            try {
              const body = { name: name.value, email: email.value, password: password.value };
              if (webhook.value.trim()) body.webhookUrl = webhook.value.trim();
              const res = await api("/portal/api/signup", { body });
              state.me = res.business;
              renderFirstKey(res.apiKey);
            } catch (ex) {
              err.textContent = ex.message;
              err.classList.remove("hidden");
            }
          },
        },
        err,
        field("Company name", name),
        field("Work email", email),
        field("Password", password, "At least 10 characters."),
        field("Webhook URL (optional)", webhook, "We'll POST status changes here. You can add or change it later."),
        h("button", { class: "btn primary", style: "width:100%;justify-content:center", type: "submit" }, "Create account")
      );
    };

    draw();
    mount(
      root,
      h(
        "div",
        { class: "auth-wrap" },
        h(
          "div",
          { class: "auth-card card" },
          h("div", { class: "brand" }, h("span", { class: "brand-mark" }), state.config.brandName),
          h("div", { class: "tagline" }, "ID verification for your business"),
          notice ? h("div", { class: "notice info" }, notice) : null,
          box
        )
      )
    );
  }

  function keyPanel(apiKey) {
    return h(
      "div",
      {},
      h("div", { class: "notice warn" }, "Copy this API key now. For security it is shown only once and cannot be recovered - if you lose it you'll need to generate a new one."),
      UI.copyBox(apiKey)
    );
  }

  function renderFirstKey(apiKey) {
    mount(
      root,
      h(
        "div",
        { class: "auth-wrap" },
        h(
          "div",
          { class: "auth-card card" },
          h("h1", {}, "Welcome, " + state.me.name),
          h("p", { class: "muted" }, "Your account is ready. Here is your API key - your servers use it to request verifications and fetch ID photos."),
          keyPanel(apiKey),
          h("div", { style: "margin-top:16px", class: "actions" },
            h("button", { class: "btn primary", onclick: () => { location.hash = "#/"; route(); } }, "I've saved it - go to dashboard"),
            h("a", { class: "btn", href: "/docs/", target: "_blank", rel: "noopener" }, "Read the API docs")
          )
        )
      )
    );
  }

  /* ---------------------------------------------------------------- layout */
  function layout(active, content) {
    const link = (hash, label, key) => h("a", { href: hash, class: active === key ? "active" : "" }, label);
    mount(
      root,
      h(
        "header",
        { class: "topbar" },
        h(
          "div",
          { class: "topbar-inner" },
          h("div", { class: "brand" }, h("span", { class: "brand-mark" }), state.config.brandName),
          h(
            "nav",
            { class: "nav" },
            link("#/", "Dashboard", "dash"),
            link("#/new", "New verification", "new"),
            link("#/verifications", "Verifications", "list"),
            link("#/settings", "Settings & API", "settings"),
            h("a", { href: "/docs/", target: "_blank", rel: "noopener" }, "API docs ↗")
          ),
          h(
            "div",
            { class: "topbar-user" },
            h("span", {}, state.me.name),
            h("button", { class: "btn sm", onclick: logout }, "Sign out")
          )
        )
      ),
      h("main", {}, content)
    );
  }

  async function logout() {
    try { await api("/portal/api/logout", { method: "POST", body: {} }); } catch (_) { /* ignore */ }
    state.me = null;
    stopTimer();
    renderAuth("login");
  }

  /* ------------------------------------------------------------- dashboard */
  async function viewDashboard() {
    const body = h("div", {}, UI.spinner());
    layout("dash", body);
    const load = async () => {
      const [stats, list] = await Promise.all([api("/portal/api/stats"), api("/api/verifications")]);
      const recent = list.verifications.slice(0, 6);
      mount(
        body,
        h("div", { class: "page-head" },
          h("div", {}, h("h1", {}, "Dashboard"), h("div", { class: "sub" }, "Your verification activity")),
          h("a", { class: "btn primary", href: "#/new" }, "+ New verification")
        ),
        h("div", { class: "grid cols-4" },
          UI.stat("Total requests", UI.fmtNum(stats.total)),
          UI.stat("Last 7 days", UI.fmtNum(stats.last7d)),
          UI.stat("Last 30 days", UI.fmtNum(stats.last30d)),
          UI.stat("Completion rate", UI.fmtPct(stats.completionRate), "Customers who submitted their ID")
        ),
        h("div", { class: "grid cols-2" },
          h("div", { class: "card" }, h("h2", {}, "Requests - last 30 days"), UI.barChart(stats.daily)),
          h("div", { class: "card" }, h("h2", {}, "By status"), UI.statusBars(stats.byStatus))
        ),
        h("div", { class: "card" },
          h("h2", {}, "Recent verifications"),
          verificationsTable(recent),
          h("div", { style: "margin-top:10px" }, h("a", { href: "#/verifications" }, "View all →"))
        )
      );
    };
    await safely(load);
    poll(() => safely(load, true), 15000);
  }

  function verificationsTable(rows) {
    if (!rows.length) return h("div", { class: "empty" }, "No verifications yet. Create one to get started.");
    return h("div", { class: "table-wrap" },
      h("table", {},
        h("thead", {}, h("tr", {}, ["Customer ID", "Type", "Status", "Created", "Updated"].map((t) => h("th", {}, t)))),
        h("tbody", {}, rows.map((v) =>
          h("tr", { class: "click", onclick: () => (location.hash = "#/verifications/" + v.id) },
            h("td", {}, h("strong", {}, v.customerId)),
            h("td", { class: "muted" }, v.customerType),
            h("td", {}, UI.statusBadge(v.status)),
            h("td", { class: "muted" }, UI.fmtDate(v.createdAt)),
            h("td", { class: "muted" }, UI.timeAgo(v.updatedAt))
          )
        ))
      )
    );
  }

  /* --------------------------------------------------------------- new one */
  function viewNew() {
    const out = h("div");
    const customerType = h("input", { type: "text", value: "customer", required: true, list: "types" });
    const customerId = h("input", { type: "text", required: true, placeholder: "e.g. cust_10293", maxlength: 200 });
    const form = h("form", {
      onsubmit: async (e) => {
        e.preventDefault();
        const btn = form.querySelector("button[type=submit]");
        btn.disabled = true;
        try {
          const v = await api("/api/verifications", { body: { customerType: customerType.value.trim(), customerId: customerId.value.trim() } });
          showCreated(v);
        } catch (ex) {
          toast(ex.message, "bad");
          btn.disabled = false;
        }
      },
    },
      h("datalist", { id: "types" }, ["customer", "employee", "tenant", "driver", "member"].map((t) => h("option", { value: t }))),
      h("div", { class: "row" },
        field("Customer type", customerType, "Your own label, echoed back on every response."),
        field("Customer ID", customerId, "Your identifier for this person - links the result to your records.")
      ),
      h("button", { class: "btn primary", type: "submit" }, "Generate QR code")
    );

    function showCreated(v) {
      stopTimer();
      const status = h("span", {}, UI.statusBadge("PENDING"));
      const review = h("a", { class: "btn primary hidden", href: "#/verifications/" + v.id }, "Review ID →");
      mount(out,
        h("div", { class: "card qr-box" },
          h("h2", {}, "Ask " + customerId.value + " to scan this"),
          h("img", { alt: "QR code for the ID capture link", src: "data:image/png;base64," + v.qrCodePngBase64 }),
          h("p", { class: "muted small", style: "margin-top:10px" }, "Expires " + UI.fmtDate(v.expiresAt) + ". They'll photograph the front and back of their ID on their phone."),
          h("div", { style: "text-align:left;max-width:520px;margin:0 auto" },
            h("div", { class: "small muted", style: "margin-bottom:4px" }, "Or send them this link"),
            UI.copyBox(v.captureUrl)
          ),
          h("p", { style: "margin-top:16px" }, "Status: ", status),
          h("div", { class: "actions", style: "justify-content:center" }, review, h("a", { class: "btn", href: "#/new", onclick: () => setTimeout(route) }, "New request"))
        )
      );
      const check = async () => {
        try {
          const cur = await api("/api/verifications/" + v.id);
          mount(status, UI.statusBadge(cur.status));
          if (cur.status !== "PENDING") review.classList.remove("hidden");
          if (cur.status !== "PENDING" && cur.status !== "ID_UPLOADED") stopTimer();
        } catch (_) { /* transient */ }
      };
      poll(check, 3000);
    }

    layout("new", h("div", {},
      h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "New verification"), h("div", { class: "sub" }, "Generate a QR code for one customer"))),
      h("div", { class: "card" }, form),
      out
    ));
  }

  /* ------------------------------------------------------------------ list */
  async function viewList() {
    const body = h("div", {}, UI.spinner());
    layout("list", body);
    let rows = [];
    let filter = "";
    let q = "";
    const tableBox = h("div");
    const draw = () => {
      const shown = rows.filter((v) => (!filter || v.status === filter) && (!q || v.customerId.toLowerCase().includes(q) || v.customerType.toLowerCase().includes(q)));
      mount(tableBox, verificationsTable(shown));
    };
    const load = async () => { rows = (await api("/api/verifications")).verifications; draw(); };
    mount(body,
      h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Verifications"), h("div", { class: "sub" }, "Most recently updated first (latest 200)"))),
      h("div", { class: "card" },
        h("div", { class: "toolbar" },
          h("input", { type: "search", placeholder: "Search customer ID…", class: "grow", oninput: (e) => { q = e.target.value.trim().toLowerCase(); draw(); } }),
          h("select", { onchange: (e) => { filter = e.target.value; draw(); } },
            h("option", { value: "" }, "All statuses"),
            UI.STATUS_ORDER.map((s) => h("option", { value: s }, UI.statusLabel(s)))
          ),
          h("button", { class: "btn", onclick: () => safely(load) }, "Refresh")
        ),
        tableBox
      )
    );
    await safely(load);
    poll(() => safely(load, true), 15000);
  }

  /* ---------------------------------------------------------------- detail */
  async function viewDetail(id) {
    const body = h("div", {}, UI.spinner());
    layout("list", body);
    const load = async () => {
      const v = await api("/api/verifications/" + encodeURIComponent(id));
      const decided = v.status === "MANUALLY_VERIFIED" || v.status === "MANUALLY_REJECTED";
      const canDecide = v.hasFrontImage && v.hasBackImage && !decided;
      const imgUrl = (side) => `/api/verifications/${encodeURIComponent(id)}/image/${side}?t=${encodeURIComponent(v.updatedAt)}`;
      const figure = (side, label) =>
        v["has" + side[0].toUpperCase() + side.slice(1) + "Image"]
          ? h("figure", {}, h("figcaption", {}, label), h("a", { href: imgUrl(side), target: "_blank", rel: "noopener" }, h("img", { src: imgUrl(side), alt: label + " of ID" })))
          : h("figure", {}, h("figcaption", {}, label), h("div", { class: "empty card" }, "Not uploaded yet"));

      mount(body,
        h("div", { class: "page-head" },
          h("div", {}, h("a", { href: "#/verifications", class: "small" }, "← All verifications"), h("h1", {}, v.customerId), h("div", { class: "sub" }, v.customerType + " · requested " + UI.fmtDate(v.createdAt))),
          h("div", { class: "actions" }, UI.statusBadge(v.status),
            canDecide ? h("button", { class: "btn danger-outline", onclick: () => reject(v) }, "Reject") : null,
            canDecide ? h("button", { class: "btn primary", onclick: () => approve(v) }, "Approve") : null)
        ),
        v.status === "PENDING" ? h("div", { class: "notice info" }, "Waiting for the customer to submit their ID. The link expires " + UI.fmtDate(v.expiresAt) + ".") : null,
        v.rejectionReason ? h("div", { class: "notice warn" }, "Reason: " + v.rejectionReason) : null,
        h("div", { class: "card" }, h("h2", {}, "ID photos"), h("div", { class: "id-images" }, figure("front", "Front"), figure("back", "Back"))),
        h("div", { class: "grid cols-2" },
          h("div", { class: "card" }, h("h2", {}, "Details"),
            h("dl", { class: "kv" },
              h("dt", {}, "Verification ID"), h("dd", {}, h("code", {}, v.id)),
              h("dt", {}, "Auto-check confidence"), h("dd", {}, v.ocrConfidence == null ? "-" : v.ocrConfidence.toFixed(1) + " / 100"),
              h("dt", {}, "Link expires"), h("dd", {}, UI.fmtDate(v.expiresAt)),
              h("dt", {}, "Last update"), h("dd", {}, UI.fmtDate(v.updatedAt)))),
          h("div", { class: "card" }, h("h2", {}, "History"),
            h("ul", { class: "timeline" }, v.statusHistory.map((e) =>
              h("li", {}, h("div", {}, h("strong", {}, e.label)), h("div", { class: "t" }, UI.fmtDate(e.createdAt) + " · " + e.actor + (e.note ? " · " + e.note : ""))))))
        )
      );
    };

    const decide = (v, decision, reason) =>
      api(`/api/verifications/${encodeURIComponent(v.id)}/decision`, { body: { decision, reason } }).then(() => { toast(decision === "verified" ? "Marked as approved" : "Marked as rejected"); return safely(load); });

    const approve = (v) =>
      UI.modal({ title: "Approve this ID?", body: h("p", {}, "This records a permanent, final decision under your company name."),
        actions: [{ label: "Cancel" }, { label: "Approve", kind: "primary", onClick: () => decide(v, "verified") }] });

    const reject = (v) => {
      const reason = h("textarea", { placeholder: "e.g. Back of the ID is blurry", maxlength: 500 });
      UI.modal({ title: "Reject this ID?", body: h("div", {}, h("p", {}, "This records a permanent, final decision under your company name."), field("Reason (optional)", reason)),
        actions: [{ label: "Cancel" }, { label: "Reject", kind: "danger", onClick: () => decide(v, "rejected", reason.value.trim() || undefined) }] });
    };

    await safely(load);
    poll(() => safely(load, true), 8000);
  }

  /* -------------------------------------------------------------- settings */
  function viewSettings() {
    const me = state.me;
    const name = h("input", { type: "text", value: me.name, required: true });
    const webhook = h("input", { type: "url", value: me.webhookUrl || "", placeholder: "https://yourapp.com/drawaid-webhook" });
    const keyPreview = h("code", {}, me.apiKeyPreview || "(created before the portal - rotate to see a preview)");

    const saveForm = h("form", {
      onsubmit: async (e) => {
        e.preventDefault();
        try {
          const res = await api("/portal/api/settings", { method: "PATCH", body: { name: name.value, webhookUrl: webhook.value.trim() } });
          state.me = res.business;
          toast("Settings saved");
          layout("settings", content());
        } catch (ex) { toast(ex.message, "bad"); }
      },
    },
      field("Company name", name, "Shown in your audit trail, e.g. \"ID Manually Verified by " + me.name + "\"."),
      field("Webhook URL", webhook, "Receives a POST on every status change. Leave empty to poll instead."),
      h("button", { class: "btn primary", type: "submit" }, "Save changes")
    );

    const rotate = () =>
      UI.modal({
        title: "Generate a new API key?",
        body: h("p", {}, "Your current key stops working immediately. Update your servers with the new key right after."),
        actions: [{ label: "Cancel" }, { label: "Generate new key", kind: "danger", onClick: async () => {
          const res = await api("/portal/api/api-key/rotate", { body: {} });
          state.me = res.business;
          UI.modal({ title: "Your new API key", body: keyPanel(res.apiKey), actions: [{ label: "I've saved it", kind: "primary" }] });
          mount(keyPreview, res.business.apiKeyPreview);
        } }],
      });

    const cur = h("input", { type: "password", autocomplete: "current-password", required: true });
    const next = h("input", { type: "password", autocomplete: "new-password", required: true, minlength: 10 });
    const pwForm = h("form", {
      onsubmit: async (e) => {
        e.preventDefault();
        try {
          await api("/portal/api/password", { body: { currentPassword: cur.value, newPassword: next.value } });
          toast("Password updated");
          cur.value = ""; next.value = "";
        } catch (ex) { toast(ex.message, "bad"); }
      },
    }, field("Current password", cur), field("New password", next, "At least 10 characters. Other browsers are signed out."), h("button", { class: "btn", type: "submit" }, "Change password"));

    const content = () => h("div", {},
      h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Settings & API"), h("div", { class: "sub" }, state.me.email))),
      h("div", { class: "grid cols-2" },
        h("div", { class: "card" }, h("h2", {}, "Company"), saveForm),
        h("div", { class: "card" },
          h("h2", {}, "API access"),
          h("dl", { class: "kv" },
            h("dt", {}, "Base URL"), h("dd", {}, UI.copyBox(state.config.baseUrl)),
            h("dt", {}, "API key"), h("dd", {}, keyPreview)),
          h("p", { class: "muted small", style: "margin-top:12px" }, "Send your key in the X-API-Key header. We only store a hash, so it can't be shown again."),
          h("div", { class: "actions" }, h("button", { class: "btn danger-outline", onclick: rotate }, "Generate new key"), h("a", { class: "btn", href: "/docs/", target: "_blank", rel: "noopener" }, "API docs ↗")))
      ),
      h("div", { class: "card" }, h("h2", {}, "Password"), pwForm)
    );
    layout("settings", content());
  }

  /* ---------------------------------------------------------------- router */
  async function safely(fn, quiet) {
    try { await fn(); } catch (e) { if (!quiet) toast(e.message, "bad"); }
  }

  function route() {
    stopTimer();
    if (!state.me) return renderAuth("login");
    const hash = location.hash || "#/";
    const detail = hash.match(/^#\/verifications\/(.+)$/);
    if (detail) return viewDetail(decodeURIComponent(detail[1]));
    if (hash === "#/new") return viewNew();
    if (hash === "#/verifications") return viewList();
    if (hash === "#/settings") return viewSettings();
    return viewDashboard();
  }

  window.addEventListener("hashchange", route);
  window.addEventListener("session-lost", (e) => {
    if (!state.me) return;
    state.me = null;
    stopTimer();
    const blocked = e.detail && e.detail.data && e.detail.data.code === "ACCOUNT_BLOCKED";
    renderAuth("login", blocked ? "This account has been blocked. Contact support." : "Your session expired. Please sign in again.");
  });

  (async function init() {
    try { state.config = await api("/portal/api/config"); } catch (_) { /* defaults */ }
    document.title = state.config.brandName + " - Company Portal";
    try { state.me = (await api("/portal/api/me")).business; } catch (_) { state.me = null; }
    route();
  })();
})();
