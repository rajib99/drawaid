import fs from "fs";
import path from "path";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { config } from "./config";
import adminRoutes from "./routes/admin";
import verificationsRoutes from "./routes/verifications";
import publicRoutes from "./routes/public";
import portalRoutes from "./routes/portal";

const app = express();

// We run behind nginx/Caddy. Without this, req.ip is the proxy's address, so every
// visitor would share one rate-limit bucket, and req.secure would always be false.
app.set("trust proxy", 1);

app.use(
  helmet({
    // The capture page needs camera access and inline JS/CSS kept simple;
    // relax CSP rather than fighting getUserMedia + canvas under a strict policy.
    contentSecurityPolicy: false,
  })
);
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/healthz", (_req, res) => res.json({ ok: true }));

const publicUploadLimiter = rateLimit({ windowMs: 60_000, limit: 20 });
const apiLimiter = rateLimit({ windowMs: 60_000, limit: 120 });
// Credential endpoints: slow down guessing. Successful logins don't count against the limit.
const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, skipSuccessfulRequests: true });
const signupLimiter = rateLimit({ windowMs: 60 * 60_000, limit: 10 });

// API responses can contain per-account data; never let a browser or proxy cache them.
const noStore: express.RequestHandler = (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
};

app.post("/portal/api/login", loginLimiter);
app.post("/portal/api/signup", signupLimiter);
app.post("/admin/login", loginLimiter);

app.use("/admin", noStore, apiLimiter, adminRoutes);
app.use("/portal/api", noStore, apiLimiter, portalRoutes);
app.use("/api/verifications", noStore, apiLimiter, verificationsRoutes);
app.use("/public/verifications", publicUploadLimiter);

// --- Web UIs ---------------------------------------------------------------
const publicDir = path.join(__dirname, "public");
app.use("/static", express.static(path.join(publicDir, "shared")));
app.use("/portal", express.static(path.join(publicDir, "portal")));
app.use("/superadmin", express.static(path.join(publicDir, "superadmin")));

// The API doc is a template: {{BASE_URL}} / {{BRAND}} are filled in per deployment.
app.get("/docs/API.md", (_req, res) => {
  const raw = fs.readFileSync(path.join(publicDir, "docs", "API.md"), "utf8");
  res
    .type("text/markdown; charset=utf-8")
    .send(raw.replace(/\{\{BASE_URL\}\}/g, config.publicBaseUrl).replace(/\{\{BRAND\}\}/g, config.brandName));
});
app.use("/docs", express.static(path.join(publicDir, "docs")));

// Static assets (capture.js, style.css) must resolve before the
// /verify/:token route below, otherwise the token param would swallow them.
app.use("/verify/assets", express.static(path.join(__dirname, "public", "verify", "assets")));

// Marketing landing page. {{BRAND}} / {{BASE_URL}} are filled in per deployment, same as the API docs.
let landingHtml: string | null = null;
app.get("/", (_req, res) => {
  landingHtml ??= fs
    .readFileSync(path.join(publicDir, "landing", "index.html"), "utf8")
    .replace(/\{\{BASE_URL\}\}/g, config.publicBaseUrl)
    .replace(/\{\{BRAND\}\}/g, config.brandName);
  res.setHeader("Cache-Control", "public, max-age=300");
  res.type("html").send(landingHtml);
});

app.use("/", publicRoutes);

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  if (err?.type === "entity.too.large" || err?.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "Upload too large" });
  }
  res.status(500).json({ error: "Internal server error" });
});

app.listen(config.port, () => {
  console.log(`VTBL server listening on port ${config.port}`);
});
