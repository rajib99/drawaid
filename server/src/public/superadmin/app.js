(function () {
  const { h, api, mount, toast, field } = UI;
  const root = document.getElementById("app");
  const state = { authed: false, brand: "DRAWAID" };
  let timer = null;
  const stopTimer = () => { if (timer) { clearInterval(timer); timer = null; } };
  const poll = (fn, ms) => { stopTimer(); timer = setInterval(fn, ms); };
  const safely = async (fn, quiet) => { try { await fn(); } catch (e) { if (!quiet) toast(e.message, "bad"); } };

  /* ------------------------------------------------------------------ login */
  function renderLogin(notice) {
    const token = h("input", { type: "password", autocomplete: "current-password", required: true });
    const err = h("div", { class: "notice bad hidden" });
    mount(root,
      h("div", { class: "auth-wrap" },
        h("div", { class: "auth-card card" },
          h("div", { class: "brand" }, h("span", { class: "brand-mark" }), state.brand, h("small", {}, "Super Admin")),
          h("div", { class: "tagline" }, "Platform administration"),
          notice ? h("div", { class: "notice info" }, notice) : null,
          h("form", {
            onsubmit: async (e) => {
              e.preventDefault();
              err.classList.add("hidden");
              try {
                await api("/admin/login", { body: { token: token.value } });
                state.authed = true;
                route();
              } catch (ex) { err.textContent = ex.message; err.classList.remove("hidden"); }
            },
          }, err, field("Admin token", token, "The ADMIN_TOKEN configured on the server."),
            h("button", { class: "btn primary", type: "submit", style: "width:100%;justify-content:center" }, "Sign in")))));
  }

  /* ----------------------------------------------------------------- layout */
  function layout(active, content) {
    const link = (hash, label, key) => h("a", { href: hash, class: active === key ? "active" : "" }, label);
    mount(root,
      h("header", { class: "topbar" },
        h("div", { class: "topbar-inner" },
          h("div", { class: "brand" }, h("span", { class: "brand-mark" }), state.brand, h("small", {}, "Super Admin")),
          h("nav", { class: "nav" }, link("#/", "Overview", "overview"), link("#/companies", "Companies", "companies"), link("#/activity", "Activity", "activity")),
          h("div", { class: "topbar-user" }, h("button", { class: "btn sm", onclick: logout }, "Sign out")))),
      h("main", {}, content));
  }

  async function logout() {
    try { await api("/admin/logout", { body: {} }); } catch (_) { /* ignore */ }
    state.authed = false;
    stopTimer();
    renderLogin();
  }

  const statusBadge = (s) => h("span", { class: "badge " + (s === "BLOCKED" ? "bad" : "ok") }, s === "BLOCKED" ? "Blocked" : "Active");

  /* --------------------------------------------------------------- overview */
  async function viewOverview() {
    const body = h("div", {}, UI.spinner());
    layout("overview", body);
    const load = async () => {
      const [o, act] = await Promise.all([api("/admin/overview"), api("/admin/activity?limit=10")]);
      mount(body,
        h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Overview"), h("div", { class: "sub" }, "Platform-wide activity · refreshes automatically"))),
        h("div", { class: "grid cols-4" },
          UI.stat("Companies", UI.fmtNum(o.businesses.total), `${o.businesses.active} active · ${o.businesses.blocked} blocked`),
          UI.stat("New companies", UI.fmtNum(o.businesses.new7d), `last 7 days · ${o.businesses.new30d} in 30 days`),
          UI.stat("Active companies", UI.fmtNum(o.businesses.activeLast30d), "sent a request in the last 30 days"),
          UI.stat("Completion rate", UI.fmtPct(o.completionRate), "customers who submitted an ID")),
        h("div", { class: "grid cols-4" },
          UI.stat("Requests today", UI.fmtNum(o.requests.today)),
          UI.stat("Last 7 days", UI.fmtNum(o.requests.last7d)),
          UI.stat("Last 30 days", UI.fmtNum(o.requests.last30d)),
          UI.stat("All time", UI.fmtNum(o.requests.total))),
        h("div", { class: "grid cols-2" },
          h("div", { class: "card" }, h("h2", {}, "Requests per day - last 30 days"), UI.barChart(o.daily)),
          h("div", { class: "card" }, h("h2", {}, "Requests by status"), UI.statusBars(o.byStatus))),
        h("div", { class: "grid cols-2" },
          h("div", { class: "card" }, h("h2", {}, "Top companies - last 30 days"),
            o.topBusinesses.length
              ? h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "Company"), h("th", { class: "num" }, "Requests"))),
                  h("tbody", {}, o.topBusinesses.map((b) => h("tr", { class: "click", onclick: () => (location.hash = "#/companies/" + b.id) },
                    h("td", {}, b.name, " ", b.status === "BLOCKED" ? statusBadge("BLOCKED") : null), h("td", { class: "num" }, UI.fmtNum(b.requests30d)))))))
              : h("div", { class: "empty" }, "No requests in the last 30 days")),
          h("div", { class: "card" }, h("h2", {}, "Latest activity"), activityTable(act.events, true), h("div", { style: "margin-top:10px" }, h("a", { href: "#/activity" }, "View all →")))));
    };
    await safely(load);
    poll(() => safely(load, true), 20000);
  }

  function activityTable(events, compact) {
    if (!events.length) return h("div", { class: "empty" }, "No activity yet");
    return h("div", { class: "table-wrap" }, h("table", {},
      h("thead", {}, h("tr", {}, h("th", {}, "When"), h("th", {}, "Company"), h("th", {}, "Event"), compact ? null : h("th", {}, "By"))),
      h("tbody", {}, events.map((e) => h("tr", { class: "click", onclick: () => (location.hash = "#/companies/" + e.business.id) },
        h("td", { class: "muted", title: UI.fmtDate(e.createdAt) }, UI.timeAgo(e.createdAt)),
        h("td", {}, e.business.name),
        h("td", {}, UI.statusBadge(e.status)),
        compact ? null : h("td", { class: "muted" }, e.actor))))));
  }

  /* -------------------------------------------------------------- companies */
  async function viewCompanies() {
    const body = h("div", {}, UI.spinner());
    layout("companies", body);
    let search = "", status = "", rows = [];
    const tableBox = h("div");
    const draw = () => mount(tableBox, rows.length
      ? h("div", { class: "table-wrap" }, h("table", {},
          h("thead", {}, h("tr", {}, ["Company", "Status", "Requests (30d)", "Total", "Last request", "Last login", "Joined", ""].map((t, i) => h("th", { class: i >= 2 && i <= 3 ? "num" : "" }, t)))),
          h("tbody", {}, rows.map((b) => h("tr", { class: "click", onclick: () => (location.hash = "#/companies/" + b.id) },
            h("td", {}, h("strong", {}, b.name), h("div", { class: "muted small" }, b.email || "API-only (no portal login)")),
            h("td", {}, statusBadge(b.status)),
            h("td", { class: "num" }, UI.fmtNum(b.requests30d)),
            h("td", { class: "num" }, UI.fmtNum(b.requestCount)),
            h("td", { class: "muted" }, UI.timeAgo(b.lastRequestAt)),
            h("td", { class: "muted" }, b.hasPortalLogin ? UI.timeAgo(b.lastLoginAt) : "-"),
            h("td", { class: "muted" }, UI.fmtDay(b.createdAt)),
            h("td", { class: "right", onclick: (e) => e.stopPropagation() }, blockButton(b, load, true)))))))
      : h("div", { class: "empty" }, "No companies match"));
    const load = async () => {
      const qs = new URLSearchParams();
      if (search) qs.set("search", search);
      if (status) qs.set("status", status);
      rows = (await api("/admin/businesses?" + qs)).businesses;
      draw();
    };
    let debounce;
    mount(body,
      h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Companies"), h("div", { class: "sub" }, "Registered businesses and their usage"))),
      h("div", { class: "card" },
        h("div", { class: "toolbar" },
          h("input", { type: "search", class: "grow", placeholder: "Search name or email…", oninput: (e) => { search = e.target.value.trim(); clearTimeout(debounce); debounce = setTimeout(() => safely(load), 250); } }),
          h("select", { onchange: (e) => { status = e.target.value; safely(load); } },
            h("option", { value: "" }, "All statuses"), h("option", { value: "ACTIVE" }, "Active"), h("option", { value: "BLOCKED" }, "Blocked"))),
        tableBox));
    await safely(load);
  }

  function blockButton(b, reload, small) {
    const cls = "btn " + (small ? "sm " : "");
    if (b.status === "BLOCKED") {
      return h("button", { class: cls, onclick: () => UI.modal({
        title: "Unblock " + b.name + "?",
        body: h("p", {}, "Their API key, portal login and outstanding capture links will work again."),
        actions: [{ label: "Cancel" }, { label: "Unblock", kind: "primary", onClick: async () => { await api(`/admin/businesses/${b.id}/unblock`, { body: {} }); toast(b.name + " unblocked"); await reload(); } }],
      }) }, "Unblock");
    }
    return h("button", { class: cls + "danger-outline", onclick: () => {
      const reason = h("textarea", { placeholder: "Internal note, also shown to the company when they try to sign in", maxlength: 500 });
      UI.modal({
        title: "Block " + b.name + "?",
        body: h("div", {}, h("p", {}, "Immediately stops their API key, portal login and any outstanding customer capture links. No data is deleted."), field("Reason (optional)", reason)),
        actions: [{ label: "Cancel" }, { label: "Block company", kind: "danger", onClick: async () => { await api(`/admin/businesses/${b.id}/block`, { body: { reason: reason.value.trim() || undefined } }); toast(b.name + " blocked"); await reload(); } }],
      });
    } }, "Block");
  }

  /* ---------------------------------------------------------- company detail */
  async function viewCompany(id) {
    const body = h("div", {}, UI.spinner());
    layout("companies", body);
    const load = async () => {
      const d = await api("/admin/businesses/" + encodeURIComponent(id));
      const b = d.business;
      const rotate = () => UI.modal({
        title: "Issue a new API key for " + b.name + "?",
        body: h("p", {}, "Their current key stops working immediately. You'll see the new key once - pass it to them securely."),
        actions: [{ label: "Cancel" }, { label: "Issue new key", kind: "danger", onClick: async () => {
          const res = await api(`/admin/businesses/${b.id}/rotate-key`, { body: {} });
          UI.modal({ title: "New API key", body: h("div", {}, h("div", { class: "notice warn" }, "Shown once. Copy it now."), UI.copyBox(res.apiKey)), actions: [{ label: "Done", kind: "primary" }] });
          await load();
        } }],
      });
      mount(body,
        h("div", { class: "page-head" },
          h("div", {}, h("a", { href: "#/companies", class: "small" }, "← All companies"), h("h1", {}, b.name, " ", statusBadge(b.status)), h("div", { class: "sub" }, b.email || "API-only account (no portal login)")),
          h("div", { class: "actions" }, h("button", { class: "btn", onclick: rotate }, "Issue new API key"), blockButton(b, load))),
        b.status === "BLOCKED" ? h("div", { class: "notice bad" }, "Blocked " + UI.fmtDate(b.blockedAt) + (b.blockedReason ? " - " + b.blockedReason : "")) : null,
        h("div", { class: "grid cols-4" },
          UI.stat("Total requests", UI.fmtNum(b.requestCount)),
          UI.stat("Last 30 days", UI.fmtNum(b.requests30d)),
          UI.stat("Completion rate", UI.fmtPct(d.completionRate)),
          UI.stat("Last request", UI.timeAgo(b.lastRequestAt))),
        h("div", { class: "grid cols-2" },
          h("div", { class: "card" }, h("h2", {}, "Requests - last 30 days"), UI.barChart(d.daily)),
          h("div", { class: "card" }, h("h2", {}, "By status"), UI.statusBars(d.byStatus))),
        h("div", { class: "grid cols-2" },
          h("div", { class: "card" }, h("h2", {}, "Account"),
            h("dl", { class: "kv" },
              h("dt", {}, "Company ID"), h("dd", {}, h("code", {}, b.id)),
              h("dt", {}, "Joined"), h("dd", {}, UI.fmtDate(b.createdAt)),
              h("dt", {}, "Last portal login"), h("dd", {}, b.hasPortalLogin ? UI.fmtDate(b.lastLoginAt) : "n/a"),
              h("dt", {}, "API key"), h("dd", {}, b.apiKeyPreview ? h("code", {}, b.apiKeyPreview) : "-"),
              h("dt", {}, "Webhook"), h("dd", {}, b.webhookUrl || "-"))),
          h("div", { class: "card" }, h("h2", {}, "Recent requests"),
            d.recentRequests.length
              ? h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "Type"), h("th", {}, "Status"), h("th", {}, "Created"))),
                  h("tbody", {}, d.recentRequests.map((r) => h("tr", {}, h("td", {}, r.customerType), h("td", {}, UI.statusBadge(r.status)), h("td", { class: "muted" }, UI.timeAgo(r.createdAt)))))))
              : h("div", { class: "empty" }, "No requests yet"),
            h("p", { class: "muted small", style: "margin-top:10px" }, "Admins see request metadata only - ID photos are visible to the company that requested them."))));
    };
    await safely(load);
    poll(() => safely(load, true), 30000);
  }

  /* --------------------------------------------------------------- activity */
  async function viewActivity() {
    const body = h("div", {}, UI.spinner());
    layout("activity", body);
    let limit = 50;
    const tableBox = h("div");
    const load = async () => mount(tableBox, activityTable((await api("/admin/activity?limit=" + limit)).events));
    mount(body,
      h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Activity"), h("div", { class: "sub" }, "Every status change across all companies · refreshes every 10s"))),
      h("div", { class: "card" },
        h("div", { class: "toolbar" }, h("select", { onchange: (e) => { limit = +e.target.value; safely(load); } }, [50, 100, 200].map((n) => h("option", { value: n }, "Latest " + n)))),
        tableBox));
    await safely(load);
    poll(() => safely(load, true), 10000);
  }

  /* ----------------------------------------------------------------- router */
  function route() {
    stopTimer();
    if (!state.authed) return renderLogin();
    const hash = location.hash || "#/";
    const company = hash.match(/^#\/companies\/(.+)$/);
    if (company) return viewCompany(decodeURIComponent(company[1]));
    if (hash === "#/companies") return viewCompanies();
    if (hash === "#/activity") return viewActivity();
    return viewOverview();
  }

  window.addEventListener("hashchange", route);
  window.addEventListener("session-lost", () => {
    if (!state.authed) return;
    state.authed = false;
    stopTimer();
    renderLogin("Your session expired. Please sign in again.");
  });

  (async function init() {
    try { state.brand = (await api("/portal/api/config")).brandName; } catch (_) { /* default */ }
    document.title = state.brand + " - Super Admin";
    try { await api("/admin/me"); state.authed = true; } catch (_) { state.authed = false; }
    route();
  })();
})();
