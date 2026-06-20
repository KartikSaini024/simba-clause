// api/chat.js
//
// Serverless function (Vercel) that proxies chat requests to OpenRouter.
// The OpenRouter API key lives ONLY here, as a server-side environment
// variable (OPENROUTER_API_KEY) — it is never sent to or visible from
// the browser.
//
// The frontend (public/index.html) calls this endpoint with the staff
// member's question and the conversation history. This function injects
// the rental agreement clause data as system context, calls OpenRouter's
// gpt-oss-120b model, and returns the answer.

const fs = require("fs");
const path = require("path");

// Load clause data once per cold start (it's small, ~30KB).
//
// IMPORTANT: process.cwd() is not reliable inside Vercel serverless
// functions — it does not always resolve to the repo root the way it
// does in local dev. We resolve relative to this file's own location
// instead (__dirname), and try a couple of likely paths so this works
// both locally (`vercel dev`) and in the deployed Lambda bundle.
let CLAUSES_TEXT = null;
function loadClauses() {
  if (CLAUSES_TEXT) return CLAUSES_TEXT;

  const candidatePaths = [
    path.join(__dirname, "..", "public", "clauses.json"), // api/ -> ../public
    path.join(process.cwd(), "public", "clauses.json"),   // local dev fallback
    path.join(__dirname, "clauses.json"),                  // bundled alongside function
    path.join("/var/task", "public", "clauses.json"),       // Vercel Lambda bundle root (includeFiles)
  ];

  let raw = null;
  let lastErr = null;
  for (const p of candidatePaths) {
    try {
      raw = fs.readFileSync(p, "utf8");
      break;
    } catch (err) {
      lastErr = err;
    }
  }

  if (raw === null) {
    throw new Error(
      "Could not locate clauses.json. Tried: " +
        candidatePaths.join(", ") +
        ". Last error: " +
        (lastErr ? lastErr.message : "unknown")
    );
  }

  const data = JSON.parse(raw);

  // Format compactly for the model: id | category | ref | title — text
  CLAUSES_TEXT = data
    .map(
      (c) =>
        `[${c.id}] (${c.cat} — ${c.ref}) ${c.title}: ${c.text}`
    )
    .join("\n\n");
  return CLAUSES_TEXT;
}

const SYSTEM_PROMPT = `You are an internal staff assistant for Simba Car Hire. Your job is to help staff quickly find and understand relevant clauses from the company's rental agreement so they can answer customer questions or resolve disputes correctly.

You will be given the full set of indexed clauses below. Each clause has an id, category, clause reference number(s), title, and a plain-English summary of what it says.

RULES:
- Always ground your answer in the clauses provided. Do not invent fees, numbers, or policies that aren't in the data.
- When you reference a clause, cite its clause reference number(s) (e.g. "Cl. 13C.B") and title so staff can look it up in the full agreement.
- If a customer situation touches multiple clauses (e.g. an accident involving a flood), mention all relevant ones.
- Keep answers concise and practical — staff are reading this while on a call or at the counter. Lead with the direct answer, then the supporting clause reference(s).
- If something genuinely isn't covered in the provided clauses, say so plainly rather than guessing — and suggest checking the full signed agreement or escalating to a manager.
- These summaries are condensed for quick reference; for anything high-stakes or disputed, remind staff to verify against the full executed agreement text.

CLAUSE DATA:
${"{{CLAUSES}}"}`;

module.exports = async function handler(req, res) {
  // CORS (only needed if you ever call this from a different origin;
  // harmless to leave on for same-origin use too)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed. Use POST." });
    return;
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    res.status(500).json({
      error:
        "Server misconfigured: OPENROUTER_API_KEY is not set in the deployment environment.",
    });
    return;
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (e) {
      res.status(400).json({ error: "Invalid JSON body." });
      return;
    }
  }

  const { messages } = body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "Request must include a non-empty 'messages' array." });
    return;
  }

  // Basic sanity limits to avoid runaway requests
  const trimmedMessages = messages.slice(-20); // keep last 20 turns max
  for (const m of trimmedMessages) {
    if (typeof m.content === "string" && m.content.length > 4000) {
      m.content = m.content.slice(0, 4000);
    }
  }

  const clauseData = loadClauses();
  const systemPrompt = SYSTEM_PROMPT.replace("{{CLAUSES}}", clauseData);

  const payload = {
    model: "openai/gpt-oss-120b",
    messages: [{ role: "system", content: systemPrompt }, ...trimmedMessages],
    temperature: 0.2,
    max_tokens: 800,
  };

  try {
    const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        // Optional but recommended by OpenRouter for analytics/rate-limit context
        "HTTP-Referer": process.env.PUBLIC_APP_URL || "https://simba-clause-finder.vercel.app",
        "X-Title": "Simba Car Hire - Staff Clause Assistant",
      },
      body: JSON.stringify(payload),
    });

    const data = await upstream.json();

    if (!upstream.ok) {
      res.status(upstream.status).json({
        error: data?.error?.message || "OpenRouter request failed.",
        details: data,
      });
      return;
    }

    const reply = data?.choices?.[0]?.message?.content;
    if (!reply) {
      res.status(502).json({ error: "No response content returned from model.", details: data });
      return;
    }

    res.status(200).json({ reply, usage: data.usage || null });
  } catch (err) {
    console.error("chat.js unexpected error:", err);
    res.status(500).json({
      error: "Unexpected server error: " + (err && err.message ? err.message : String(err)),
    });
  }
};
