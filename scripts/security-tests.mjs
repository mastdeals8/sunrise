#!/usr/bin/env node
/**
 * Sunrise ERP — Security Test Suite (Phase 2 hardening)
 * Usage: node scripts/security-tests.mjs [baseUrl]
 * Requires: a running server, env QA_USER/QA_PASS for an admin account
 * (defaults qaadmin / QaTest@12345 for local test DBs).
 */
const BASE = process.argv[2] || "http://localhost:5000";
const USER = process.env.QA_USER || "qaadmin";
const PASS = process.env.QA_PASS || "QaTest@12345";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? " — " + detail : ""}`);
  ok ? pass++ : fail++;
};

const res = await fetch(`${BASE}/api/auth/login`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: USER, password: PASS }),
});
const setCookie = res.headers.get("set-cookie") || "";
const { token } = await res.json().catch(() => ({}));
check("login works", res.ok);
check("login sets httpOnly session cookie", /sunrise_session=.*HttpOnly/i.test(setCookie));
check("cookie is SameSite=Lax", /SameSite=Lax/i.test(setCookie));
const cookie = (setCookie.match(/sunrise_session=([^;]+)/) || [])[0] || "";

// C1 — uploads require auth
let r = await fetch(`${BASE}/uploads/test-invoice.pdf`);
check("anonymous /uploads blocked (401)", r.status === 401, `got ${r.status}`);
r = await fetch(`${BASE}/uploads/test-invoice.pdf`, { headers: { Cookie: cookie } });
check("cookie /uploads allowed", r.status === 200 || r.status === 404, `got ${r.status}`);
r = await fetch(`${BASE}/uploads/test-invoice.pdf`, { headers: { Authorization: `Bearer ${token}` } });
check("bearer /uploads allowed", r.status === 200 || r.status === 404, `got ${r.status}`);

// C3 — query tokens dead
r = await fetch(`${BASE}/uploads/test-invoice.pdf?token=${token}`);
check("query-string token rejected (401)", r.status === 401, `got ${r.status}`);

// C4 — headers + rate limit
r = await fetch(`${BASE}/api/auth/user`);
check("helmet: X-Content-Type-Options", r.headers.get("x-content-type-options") === "nosniff");
check("helmet: X-Frame-Options", !!r.headers.get("x-frame-options"));
let last = 0;
for (let i = 0; i < 12; i++) {
  const rr = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USER, password: "wrong-password" }),
  });
  last = rr.status;
}
check("login brute-force limited (429)", last === 429, `12th attempt → ${last}`);

// Cookie-first: API works with cookie only (no Bearer)
r = await fetch(`${BASE}/api/auth/user`, { headers: { Cookie: cookie } });
check("API auth via cookie only", r.status === 200, `got ${r.status}`);
r = await fetch(`${BASE}/api/auth/user`, { headers: { Cookie: cookie, Authorization: "Bearer null" } });
check("'Bearer null' header doesn't break cookie auth", r.status === 200, `got ${r.status}`);

// H2 — upload filter
const fd = new FormData();
fd.append("file", new Blob(["MZ"], { type: "application/x-msdownload" }), "evil.exe");
r = await fetch(`${BASE}/api/operations/upload`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
check("disallowed .exe upload rejected", r.status >= 400, `got ${r.status}`);

// Role enforcement on exports (Tally export requires admin/accounts/manager)
r = await fetch(`${BASE}/api/tally/export-xml/999999`, { headers: { Authorization: `Bearer ${token}` } });
check("tally export reachable for admin (404 for fake id ok)", [200, 404].includes(r.status), `got ${r.status}`);
r = await fetch(`${BASE}/api/tally/export-xml/999999`);
check("tally export blocked anonymously (401)", r.status === 401, `got ${r.status}`);

// Field links: bad token rejected
r = await fetch(`${BASE}/api/field/not-a-real-token`);
check("invalid field-link token rejected", r.status >= 400, `got ${r.status}`);

// Templates now require auth
r = await fetch(`${BASE}/api/templates/CLIENTS_TEMPLATE`);
check("template download blocked anonymously (401)", r.status === 401, `got ${r.status}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
