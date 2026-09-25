# {{BRAND}} Integration Guide

{{BRAND}} lets your business verify a customer's government ID without building anything yourself. You ask us for a QR code, the customer scans it on their phone and photographs the front and back of their ID, and you fetch the photos and the result into your own app.

Base URL for everything in this guide: `{{BASE_URL}}`

## How it works

1. **Your backend requests a verification** for one customer and gets back a QR code and a link.
2. **You show the QR code** to the customer (kiosk, checkout screen, receipt, email, SMS: anywhere), or send them the link.
3. **The customer scans it.** A mobile web page opens, asks for camera permission, and walks them through photographing the front and back of their ID. No app install and no account.
4. **{{BRAND}} receives the photos** and runs an automated visual check (text legibility, ID-number and date sanity checks).
5. **You're notified** by webhook, or you poll, that the status changed.
6. **Your backend downloads the photos** and records a final `verified` or `rejected` decision, which is stored permanently under your company name.

> The automated check is a fast pre-screen, not a certified identity or KYC/AML product. Treat your own decision (step 6) as the system of record.

## 1. Register your company

You can sign up yourself in under a minute.

1. Open **`{{BASE_URL}}/portal`** and choose **Register company**.
2. Enter your company name, work email and a password (at least 10 characters). Optionally add a webhook URL now; you can add or change it later.
3. **Copy your API key.** It's displayed once, right after registration. We store only a hash, so it can't be shown again.

From the portal you can then:

| Page | What you can do |
| --- | --- |
| **Dashboard** | See request volume, completion rate and a status breakdown. |
| **New verification** | Generate a QR code for a customer and watch its status live. Good for manual or in-person use. |
| **Verifications** | Search and filter every request, open the ID photos, approve or reject. |
| **Settings & API** | Change your webhook URL, generate a new API key, change your password. |

> **Lost your key?** Sign in to the portal and choose **Settings & API → Generate new key**. The old key stops working immediately.

> **Blocked accounts.** {{BRAND}} may block an account that breaks the terms of use. While blocked, your API key and portal login are refused with HTTP `403` and code `ACCOUNT_BLOCKED`, and outstanding customer QR links stop working. Contact support to have it reviewed.

## 2. Authentication

Send your API key in the `X-API-Key` header on every request:

```bash
curl {{BASE_URL}}/api/verifications \
  -H "X-API-Key: vtbl_your_key_here"
```

**Keep the key on your server.** Never put it in a mobile app, browser JavaScript or a public repository, because anyone holding it can read your customers' ID photos. Your frontend should call *your* backend, and your backend calls {{BRAND}}.

All requests and responses are JSON (`Content-Type: application/json`), except the image endpoint, which returns the image itself. Timestamps are ISO 8601 in UTC.

## 3. Quick start

Try the whole flow with `curl`.

```bash
export KEY=vtbl_your_key_here

# 1. Request a verification
curl -s -X POST {{BASE_URL}}/api/verifications \
  -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"customerType":"customer","customerId":"cust_10293"}' > resp.json

# 2. See the id and link, and save the QR code as an image
python3 -c "import json;d=json.load(open('resp.json'));print(d['id']);print(d['captureUrl'])"
python3 -c "import json,base64;open('qr.png','wb').write(base64.b64decode(json.load(open('resp.json'))['qrCodePngBase64']))"
open qr.png    # macOS; use xdg-open on Linux

# 3. Scan qr.png with a phone and photograph an ID (use a dummy ID for testing)

# 4. Check the status
curl -s -H "X-API-Key: $KEY" {{BASE_URL}}/api/verifications/<id>

# 5. Download the photos
curl -s -H "X-API-Key: $KEY" {{BASE_URL}}/api/verifications/<id>/image/front -o front.jpg
curl -s -H "X-API-Key: $KEY" {{BASE_URL}}/api/verifications/<id>/image/back  -o back.jpg

# 6. Record your decision
curl -s -X POST {{BASE_URL}}/api/verifications/<id>/decision \
  -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"decision":"verified"}'
```

## 4. Status lifecycle

Every request moves through these states. Each change is recorded permanently with a timestamp in `statusHistory`.

| Status | Meaning |
| --- | --- |
| `PENDING` | QR/link issued, waiting for the customer to submit photos. |
| `ID_UPLOADED` | Front and back photos received. Automated check running. |
| `VISUALLY_VERIFIED` | Passed the automated check ("ID Visually Verified by {{BRAND}} Software"). |
| `VISUALLY_REJECTED` | Failed the automated check. See `rejectionReason`. |
| `MANUALLY_VERIFIED` | You approved it ("ID Manually Verified by *Your Company*"). Final. |
| `MANUALLY_REJECTED` | You rejected it. Final. |
| `EXPIRED` | The customer didn't complete the flow before the link expired. |

```
PENDING ──► ID_UPLOADED ──► VISUALLY_VERIFIED ──┐
   │                    └─► VISUALLY_REJECTED ──┼──► MANUALLY_VERIFIED
   └──► EXPIRED                                 └──► MANUALLY_REJECTED
```

`VISUALLY_*` is our automated opinion. You can record a manual decision at any point after both photos are in, including after a visual rejection or when the automated check couldn't run (the request then stays at `ID_UPLOADED`).

Capture links are valid for **30 minutes** by default; the exact deadline is `expiresAt` in the create response. A link can be used once: after the customer submits, it shows an "already submitted" page.

## 5. API reference

### Create a verification

```
POST /api/verifications
```

| Body field | Type | Required | Description |
| --- | --- | --- | --- |
| `customerType` | string | yes | Your own label, e.g. `customer`, `employee`, `driver`. |
| `customerId` | string | yes | Your identifier for this person. |

`customerType` and `customerId` are opaque to {{BRAND}}. They come back unchanged on every response, so use them to match a result to your own records.

**Response `201`**

```json
{
  "id": "b7e2c1a4-5d3f-4f0a-9c2e-1a2b3c4d5e6f",
  "token": "1k9F...",
  "status": "PENDING",
  "captureUrl": "{{BASE_URL}}/verify/1k9F...",
  "qrCodePngBase64": "iVBORw0KGgoAAAANSUhEUgAA...",
  "expiresAt": "2026-09-25T15:30:00.000Z",
  "createdAt": "2026-09-25T15:00:00.000Z"
}
```

| Field | Description |
| --- | --- |
| `id` | The verification ID. Use it in every other call. |
| `captureUrl` | The link the customer opens. Send it by SMS/email, or encode it yourself. |
| `qrCodePngBase64` | A ready-made PNG QR code of `captureUrl`, base64-encoded. Show it with `<img src="data:image/png;base64,...">`. |
| `expiresAt` | When the link stops working. |

### Get one verification

```
GET /api/verifications/{id}
```

```json
{
  "id": "b7e2c1a4-5d3f-4f0a-9c2e-1a2b3c4d5e6f",
  "customerType": "customer",
  "customerId": "cust_10293",
  "status": "VISUALLY_VERIFIED",
  "hasFrontImage": true,
  "hasBackImage": true,
  "ocrConfidence": 78.4,
  "rejectionReason": null,
  "expiresAt": "2026-09-25T15:30:00.000Z",
  "createdAt": "2026-09-25T15:00:00.000Z",
  "updatedAt": "2026-09-25T15:04:12.000Z",
  "statusHistory": [
    { "status": "PENDING", "label": "ID Verification Requested", "actor": "Acme Corp", "note": null, "createdAt": "2026-09-25T15:00:00.000Z" },
    { "status": "ID_UPLOADED", "label": "ID Uploaded", "actor": "system", "note": "Front and back images received", "createdAt": "2026-09-25T15:03:40.000Z" },
    { "status": "VISUALLY_VERIFIED", "label": "ID Visually Verified by {{BRAND}} Software", "actor": "system", "note": null, "createdAt": "2026-09-25T15:04:12.000Z" }
  ]
}
```

| Field | Description |
| --- | --- |
| `hasFrontImage`, `hasBackImage` | Whether the photo has been uploaded and can be downloaded. |
| `ocrConfidence` | Average text-recognition confidence, 0-100. `null` until the automated check has run. |
| `rejectionReason` | Why the automated check failed, or the reason you gave when rejecting. |
| `statusHistory` | Full audit trail, oldest first. `actor` is `system`, or your company name for your own actions. |

### List and poll

```
GET /api/verifications?status=&since=&customerId=
```

All query parameters are optional.

| Parameter | Description |
| --- | --- |
| `status` | Only requests in this status, e.g. `ID_UPLOADED`. |
| `customerId` | Only requests for this customer. |
| `since` | ISO timestamp. Only requests **updated** after it. |

Returns `{ "verifications": [ ... ] }`, most recently updated first, up to 200. Each item has the same shape as *Get one verification*.

Polling pattern: remember the time of your last poll and pass it as `since` next time, so you only receive what changed.

### Download the ID photos

```
GET /api/verifications/{id}/image/front
GET /api/verifications/{id}/image/back
```

Returns the raw image with `Content-Type` `image/jpeg`, `image/png` or `image/webp`. Returns `404` if that side hasn't been uploaded yet (check `hasFrontImage` / `hasBackImage`).

Call this from your **backend** (it needs your API key), then store or forward the image however you like. See the recipes below.

### Record your decision

```
POST /api/verifications/{id}/decision
```

```json
{ "decision": "verified" }
```

```json
{ "decision": "rejected", "reason": "Back of the ID is blurry" }
```

| Field | Description |
| --- | --- |
| `decision` | `verified` or `rejected`. |
| `reason` | Optional, up to 500 characters. Stored when rejecting. |

Sets the status to `MANUALLY_VERIFIED` or `MANUALLY_REJECTED`, recorded permanently with your company name. It returns `409` if both photos haven't been uploaded yet. This is a final state, so make the call once you're satisfied.

## 6. Webhooks

Set a **webhook URL** in the portal (Settings & API) and {{BRAND}} will send you a `POST` on **every** status change:

```json
{
  "verificationId": "b7e2c1a4-5d3f-4f0a-9c2e-1a2b3c4d5e6f",
  "customerType": "customer",
  "customerId": "cust_10293",
  "status": "ID_UPLOADED",
  "statusLabel": "ID Uploaded",
  "timestamp": "2026-09-25T15:03:40.000Z"
}
```

Rules to design around:

- **Best effort.** One attempt, 5 second timeout, no retries. Treat a webhook as a *nudge to go fetch the record*, and always keep polling as a fallback.
- **Respond quickly** with any `2xx`. Do the heavy work (downloading photos) after responding.
- **Redirects aren't followed.** Give us the final URL.
- **The URL must be public.** Localhost, private-network addresses (`10.x`, `192.168.x`, `172.16-31.x`) and `*.local` names are rejected. To test locally, expose your machine with a tunnel such as ngrok or Cloudflare Tunnel.
- **Verify by fetching.** The payload carries no secret, so don't trust it blindly: on receipt, call `GET /api/verifications/{id}` with your API key and act on *that* response.

## 7. Integration recipes

### Node.js: request a QR code and fetch the photos

This is a complete backend sketch using Express and the built-in `fetch` (Node 18+).

```js
import express from "express";
import fs from "node:fs/promises";

const VTBL = "{{BASE_URL}}";
const headers = { "X-API-Key": process.env.VTBL_API_KEY, "Content-Type": "application/json" };

const app = express();
app.use(express.json());

// Your frontend calls this. The API key never leaves your server.
app.post("/start-verification", async (req, res) => {
  const r = await fetch(`${VTBL}/api/verifications`, {
    method: "POST",
    headers,
    body: JSON.stringify({ customerType: "customer", customerId: req.body.userId }),
  });
  if (!r.ok) return res.status(502).json({ error: "Could not start verification" });
  const v = await r.json();
  // Save v.id against your user so you can match the webhook later.
  res.json({ verificationId: v.id, qrPngBase64: v.qrCodePngBase64, link: v.captureUrl, expiresAt: v.expiresAt });
});

// {{BRAND}} calls this on every status change.
app.post("/vtbl-webhook", express.json(), async (req, res) => {
  res.sendStatus(200); // respond first
  const { verificationId } = req.body;

  // Don't trust the payload: fetch the real record.
  const v = await (await fetch(`${VTBL}/api/verifications/${verificationId}`, { headers })).json();
  if (!v.hasFrontImage || !v.hasBackImage) return;

  for (const side of ["front", "back"]) {
    const img = await fetch(`${VTBL}/api/verifications/${verificationId}/image/${side}`, { headers });
    await fs.writeFile(`./ids/${verificationId}-${side}.jpg`, Buffer.from(await img.arrayBuffer()));
  }

  // ...review the photos (or your own rules), then decide:
  await fetch(`${VTBL}/api/verifications/${verificationId}/decision`, {
    method: "POST",
    headers,
    body: JSON.stringify({ decision: "verified" }),
  });
});

app.listen(4000);
```

Show the QR code in your frontend:

```html
<img alt="Scan to verify your ID" src="data:image/png;base64,PASTE_qrPngBase64_HERE">
```

### Python: poll until the customer is done

```python
import os, time, requests

BASE = "{{BASE_URL}}"
H = {"X-API-Key": os.environ["VTBL_API_KEY"]}

v = requests.post(f"{BASE}/api/verifications", headers=H,
                  json={"customerType": "customer", "customerId": "cust_10293"}).json()
print("Send the customer to:", v["captureUrl"])

while True:
    cur = requests.get(f"{BASE}/api/verifications/{v['id']}", headers=H).json()
    if cur["status"] in ("ID_UPLOADED", "VISUALLY_VERIFIED", "VISUALLY_REJECTED"):
        break
    if cur["status"] == "EXPIRED":
        raise SystemExit("Customer never completed it")
    time.sleep(3)

for side in ("front", "back"):
    img = requests.get(f"{BASE}/api/verifications/{v['id']}/image/{side}", headers=H)
    open(f"{v['id']}-{side}.jpg", "wb").write(img.content)

requests.post(f"{BASE}/api/verifications/{v['id']}/decision", headers=H, json={"decision": "verified"})
```

### Catch-up sync (no webhooks)

```bash
# Everything that changed since your last successful sync
curl -s -H "X-API-Key: $KEY" \
  "{{BASE_URL}}/api/verifications?since=2026-09-25T15:00:00.000Z"
```

## 8. Errors and limits

Errors return a JSON body with a human-readable message:

```json
{ "error": "Cannot decide before both ID images are uploaded" }
```

| HTTP | Meaning |
| --- | --- |
| `400` | Invalid input, e.g. missing `customerId`, or a bad `since` date. |
| `401` | Missing or invalid API key. |
| `403` | Account blocked (`"code": "ACCOUNT_BLOCKED"`). Contact support. |
| `404` | Verification not found. It doesn't exist, or belongs to another company. |
| `409` | Wrong state, e.g. deciding before the photos are in. |
| `413` | Upload too large (customer-side; see below). |
| `429` | Rate limited. Slow down and retry. |
| `5xx` | Our side. Safe to retry after a short wait. |

**Limits**

| Limit | Value |
| --- | --- |
| API rate limit | 120 requests per minute per IP address. Prefer webhooks or `since` polling over tight loops. |
| Photo formats | JPEG, PNG, WebP. |
| Photo size | 10 MB per image. |
| Capture link lifetime | 30 minutes by default. |
| List size | 200 verifications per call. |

## 9. Good practice

- **Keep the API key server-side** and store it in a secrets manager, never in source control.
- **Don't keep ID photos longer than you need them.** The API doesn't currently offer a delete endpoint, so download what you need, store it under your own retention policy, and treat it as sensitive personal data.
- **Use HTTPS everywhere**, including your webhook endpoint.
- **Make your handler idempotent.** A webhook and a poll can both report the same change, so handling one twice must be harmless.
- **Always record a decision.** The automated check helps you triage; your `verified`/`rejected` call is what's recorded as authoritative.

## 10. FAQ

**What does the customer see?** A mobile page that asks for camera access, guides them through front then back, and finishes with a thank-you screen. It works in Chrome and other modern mobile browsers.

**The customer's camera doesn't start.** The page needs camera permission and a secure (HTTPS) connection. Ask them to allow the camera prompt, and to open the link in a normal browser rather than an in-app one if it fails.

**The link says it expired.** Create a new verification. Links are single-use and time-limited by design.

**Can I test without a real ID?** Yes. Use a dummy or sample ID image. The automated check may reject it (that's the point of the check), but you can still exercise the full flow and record a manual decision.

**Can two companies see each other's data?** No. Every call is scoped to your API key, and other companies' verifications return `404`.
