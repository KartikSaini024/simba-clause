# Simba Car Hire — Staff Clause Finder

An internal tool for staff to quickly look up rental agreement clauses by
keyword, or ask a plain-English question and get an AI-assisted answer
grounded in the agreement.

Two ways to find a clause:

1. **Keyword search** — instant, runs entirely in the browser, no API calls.
2. **Ask the assistant** — a chat box that sends the question to an AI model
   (`openai/gpt-oss-120b` via [OpenRouter](https://openrouter.ai)), which
   answers using the same clause data, citing clause numbers.

## Why this needs a backend

The chat feature calls an LLM, which requires an API key. That key must
**never** be embedded in frontend code — anything shipped to the browser
(HTML, JS, even "hidden" strings) is visible to anyone who opens dev tools
or views page source, and a leaked key can be used to run up charges on
your OpenRouter account.

So this repo is structured as:

- `public/index.html` — static frontend (search UI + chat UI). No secrets.
- `public/clauses.json` — the indexed clause data, used both by the
  frontend (keyword search) and the backend (chat context).
- `api/chat.js` — a Vercel serverless function. This is the *only* place
  the OpenRouter API key is read, from a server-side environment variable.
  The browser never sees it.

The frontend calls `POST /api/chat`, the serverless function adds the key
and the clause context, calls OpenRouter, and returns just the answer.

## File structure

```
.
├── api/
│   └── chat.js          # Serverless function — calls OpenRouter (key lives here)
├── public/
│   ├── index.html        # Frontend — search UI + chat UI
│   └── clauses.json       # Indexed clause data (59 clauses, 12 categories)
├── package.json
├── vercel.json
├── .env.example
└── .gitignore
```

## Setup

### 1. Push this to a Git repo

```bash
git init
git add .
git commit -m "Initial commit: Simba clause finder"
git remote add origin <your-repo-url>
git push -u origin main
```

`.gitignore` already excludes `.env` and `.vercel/`, so you won't
accidentally commit secrets.

### 2. Deploy to Vercel

Easiest path — via the Vercel dashboard:

1. Go to [vercel.com/new](https://vercel.com/new) and import the Git repo.
2. Vercel will auto-detect this as a static + serverless functions project
   (no build step needed — `vercel.json` is already configured).
3. **Before the first deploy finishes (or right after), add an environment
   variable:**
   - Go to your project → **Settings → Environment Variables**.
   - Add `OPENROUTER_API_KEY` with your real OpenRouter key as the value.
   - Apply it to Production (and Preview/Development if you want those to
     work too).
   - Optionally add `PUBLIC_APP_URL` set to your deployed URL
     (e.g. `https://your-project.vercel.app`) — this is just sent as a
     referrer header to OpenRouter for their analytics, not required.
4. Redeploy (or trigger a new deploy) so the function picks up the env var.

Or via the CLI:

```bash
npm install -g vercel
vercel login
vercel link
vercel env add OPENROUTER_API_KEY production
# paste your key when prompted
vercel --prod
```

### 3. Get an OpenRouter API key

If you don't already have one: [openrouter.ai/keys](https://openrouter.ai/keys).
Add credit to the account — `gpt-oss-120b` is a paid model (check current
pricing on OpenRouter; it's relatively inexpensive but not free).

**Important:** rotate/regenerate your OpenRouter key before deploying if
it has ever been pasted into a chat, doc, or anywhere outside an
environment-variable field — treat any previously-shared key as
compromised.

### 4. Local development (optional)

```bash
npm install -g vercel   # if you haven't already
cp .env.example .env
# edit .env and add your real OPENROUTER_API_KEY
vercel dev
```

This runs the static frontend and the serverless function together
locally, reading `.env` for the key. Visit the URL it prints (usually
`http://localhost:3000`).

## Updating the clause data

`public/clauses.json` is an array of objects:

```json
{
  "id": "fee-bond",
  "cat": "Fees & Charges",
  "title": "Security Bond",
  "ref": "Front page / 13.3–13.4",
  "tags": "deposit bond hold",
  "text": "Security Bond of AUD $500–$2000 deducted from your card…"
}
```

To add or edit a clause, just edit this file and redeploy. Both the
keyword search (frontend) and the chat assistant (backend, via
`api/chat.js`) read from it, so updates apply to both at once.

Note: the frontend embeds a copy of this data directly inside
`index.html` at build time of this repo (for instant client-side search
with no network round-trip). If you edit `clauses.json`, you'll also want
to regenerate the embedded copy in `index.html` — or, for simpler ongoing
maintenance, you can switch `index.html` to `fetch('/clauses.json')` on
load instead of using an inline copy. That's a quick change if you'd like
it; just ask.

## Cost and usage notes

- Every message sent in "Ask the assistant" mode triggers one OpenRouter
  API call, which costs a small amount based on token usage. Keyword
  search is free (no API calls).
- The serverless function caps conversation history sent to the model
  (last 20 messages) and truncates very long individual messages, to keep
  costs predictable.
- Consider setting a spending limit on your OpenRouter account
  ([openrouter.ai/settings/credits](https://openrouter.ai/settings/credits))
  as a safety net.

## Security notes

- The OpenRouter key is read only from `process.env.OPENROUTER_API_KEY`
  inside `api/chat.js`, which runs server-side on Vercel. It is never
  included in any response sent to the browser.
- `.env` is git-ignored — don't remove that from `.gitignore`.
- This tool has no login/auth by default — anyone who can reach the
  deployed URL can use the chat feature (and consume your OpenRouter
  credit). If this needs to be restricted to staff only, the simplest
  options are:
  - Vercel's built-in **Password Protection** (available on Pro plans),
  or
  - Putting the deployment behind your existing SSO/VPN, or
  - Adding simple shared-secret auth to `api/chat.js` (ask if you'd like
    this added).

## Disclaimer

This tool summarises and indexes clauses from the Simba Car Hire rental
agreement for quick staff reference. The AI assistant can make mistakes
or miss nuance — always verify clause numbers and exact wording against
the full executed agreement before quoting fees or policy to a customer,
especially for disputes or high-value claims. Not legal advice.
