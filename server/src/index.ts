import path from "path";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { config } from "./config";
import adminRoutes from "./routes/admin";
import verificationsRoutes from "./routes/verifications";
import publicRoutes from "./routes/public";

const app = express();

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

app.use("/admin", apiLimiter, adminRoutes);
app.use("/api/verifications", apiLimiter, verificationsRoutes);
app.use("/public/verifications", publicUploadLimiter);

// Static assets (capture.js, style.css) must resolve before the
// /verify/:token route below, otherwise the token param would swallow them.
app.use("/verify/assets", express.static(path.join(__dirname, "public", "verify", "assets")));

app.use("/", publicRoutes);

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  if (err?.type === "entity.too.large" || err?.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "Upload too large" });
  }
  res.status(500).json({ error: "Internal server error" });
});

app.listen(config.port, () => {
  console.log(`DRAWAID server listening on port ${config.port}`);
});
