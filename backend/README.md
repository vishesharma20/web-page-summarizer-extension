# Backend proxy — deployment guide

This is a tiny Cloudflare Worker that holds your Groq API key **server-side**.
The extension talks to this Worker; the Worker talks to Groq. Your key never
appears in the extension's code, so anyone who installs or inspects the
extension cannot see or steal it.

Cloudflare's free tier is plenty for this (100,000 requests/day).

## 1. Prerequisites

- A free Cloudflare account: https://dash.cloudflare.com/sign-up
- A free Groq API key: https://console.groq.com/keys
- Node.js installed (for the `wrangler` CLI)

## 2. Install Wrangler (Cloudflare's CLI)

```bash
npm install -g wrangler
wrangler login
```

This opens a browser tab to authorize the CLI against your Cloudflare account.

## 3. Create the rate-limit KV namespace

From inside the `backend/` folder:

```bash
cd backend
wrangler kv namespace create RATE_LIMIT_KV
```

This prints something like:

```
{ binding = "RATE_LIMIT_KV", id = "abcd1234..." }
```

Copy that `id` value into `wrangler.toml`, replacing `PASTE_YOUR_KV_NAMESPACE_ID_HERE`.

## 4. Set your secrets

These are stored encrypted by Cloudflare, never written to any file:

```bash
wrangler secret put GROQ_API_KEY
# paste your Groq key when prompted

wrangler secret put SHARED_SECRET
# make up any random string, e.g. run: openssl rand -hex 16
# paste that string when prompted
```

Keep a copy of the `SHARED_SECRET` value — you'll paste it into the extension
in step 6.

## 5. Deploy

```bash
wrangler deploy
```

Wrangler will print your Worker's live URL, something like:

```
https://webpage-summarizer-proxy.YOUR-SUBDOMAIN.workers.dev
```

## 6. Wire it up to the extension

Open `background.js` (in the extension root, not the backend folder) and edit
the two constants near the top:

```js
const DEVELOPER_PROXY_URL = "https://webpage-summarizer-proxy.YOUR-SUBDOMAIN.workers.dev/summarize";
const EXTENSION_SHARED_SECRET = "the-random-string-you-set-as-SHARED_SECRET";
```

Reload the extension at `chrome://extensions` (the refresh icon on the card).
The popup's default engine — **"AI (built-in)"** — will now route through
your Worker and use your Groq key automatically. Users never see or enter a
key.

## Notes on limits & abuse protection

- `PER_IP_HOURLY_LIMIT` and `GLOBAL_DAILY_LIMIT` in `worker.js` cap usage so
  nobody (including a bug in your own extension) can run up an unexpected
  bill. Tune these numbers to taste.
- `SHARED_SECRET` filters out random bots that find the URL and hit it
  directly — it is **not** a real secret once the extension is public (any
  user can read it from your source), but combined with the rate limits
  above it keeps casual abuse in check. This is the same tradeoff every
  client-embedded API proxy makes.
- If the Worker is ever unreachable, slow, or over budget, the extension
  automatically falls back to the local (offline) summarizer — so it never
  just breaks for a user.
