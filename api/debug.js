// api/debug.js
//
// Diagnostic endpoint — visit /api/debug in your browser after deploying
// to confirm the server-side environment is configured correctly.
// It NEVER returns the actual key value, only whether it's present and
// what it looks like at a glance (prefix + length) so you can confirm
// you pasted the right thing without leaking it.
//
// Safe to leave deployed, but you can also delete this file once
// everything's working if you'd rather not expose configuration status
// publicly.

const fs = require("fs");
const path = require("path");

module.exports = function handler(req, res) {
  const key = process.env.NVIDIA_API_KEY;

  const candidatePaths = [
    path.join(__dirname, "..", "public", "clauses.json"),
    path.join(process.cwd(), "public", "clauses.json"),
    path.join(__dirname, "clauses.json"),
    path.join("/var/task", "public", "clauses.json"),
  ];

  const pathChecks = candidatePaths.map((p) => {
    try {
      fs.accessSync(p, fs.constants.R_OK);
      return { path: p, readable: true };
    } catch (err) {
      return { path: p, readable: false, error: err.code || String(err) };
    }
  });

  res.status(200).json({
    nvidia_key_present: Boolean(key),
    nvidia_key_prefix: key ? key.slice(0, 10) + "…" : null,
    nvidia_key_length: key ? key.length : 0,
    node_version: process.version,
    runtime_region: process.env.VERCEL_REGION || "unknown",
    cwd: process.cwd(),
    dirname: __dirname,
    clauses_json_path_checks: pathChecks,
    timestamp: new Date().toISOString(),
  });
};
