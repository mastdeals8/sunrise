import { createServer } from "http";
import express, { Response } from "express";
import jwt from "jsonwebtoken";
import { createClient } from "@supabase/supabase-js";
import {
  resolveUserFromToken,
  authenticateToken,
  requireRole,
  AuthRequest,
} from "../server/auth";
import { JWT_SECRET } from "../server/config";
import { pool } from "../server/db";

async function runAuthRegressionTests() {
  console.log("=================================================");
  console.log("SUNRISE MEDIA ERP — DUAL SUPABASE & EXPRESS AUTH REGRESSION TESTS");
  console.log("=================================================\n");

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, desc: string) {
    if (condition) {
      console.log(`  ✅ PASS: ${desc}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${desc}`);
      failed++;
    }
  }

  // ---------------------------------------------------------------------------
  // Part 1: Token resolution unit tests
  // ---------------------------------------------------------------------------
  console.log("--- PART 1: Token Resolution & Guarding ---");

  const nullRes = await resolveUserFromToken(null as any);
  assert(nullRes === null, "Null token is safely rejected");

  const undefinedRes = await resolveUserFromToken(undefined as any);
  assert(undefinedRes === null, "Undefined token is safely rejected");

  const stringNullRes = await resolveUserFromToken("null");
  assert(stringNullRes === null, "'null' string literal token is safely rejected");

  const stringUndefinedRes = await resolveUserFromToken("undefined");
  assert(stringUndefinedRes === null, "'undefined' string literal token is safely rejected");

  const forgedRes = await resolveUserFromToken("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.forged_signature");
  assert(forgedRes === null, "Forged token signature is safely rejected");

  // Local Express JWT
  const localToken = jwt.sign({ id: 1, username: "admin", role: "admin" }, JWT_SECRET);
  const localUser = await resolveUserFromToken(localToken);
  assert(localUser !== null && localUser.id === 1, "Local Express JWT resolves user successfully");
  assert(localUser?.isSuperAdmin === true, "Local admin user has isSuperAdmin=true");
  assert(Array.isArray(localUser?.memberships) && localUser.memberships.length >= 1, "Local user company memberships loaded");

  // Real Supabase Auth access token
  console.log("\n--- PART 2: Real Supabase Auth Access Token Resolution ---");
  const sbUrl = process.env.VITE_SUPABASE_URL || "https://kbnjiidfpqnklaljtuoj.supabase.co";
  const sbAnon = process.env.VITE_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtibmppaWRmcHFua2xhbGp0dW9qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1MTgxNTAsImV4cCI6MjA5NTA5NDE1MH0.e-EBX7b_CqTuELIShfnvEdGFIuXitP1P1yOK06WpIS0";
  const sb = createClient(sbUrl, sbAnon);

  const { data: resolvedEmail } = await sb.rpc("verify_and_resolve_login", {
    p_identifier: "admin",
    p_password: "admin123",
  });
  assert(!!resolvedEmail, "Supabase verify_and_resolve_login resolves admin identifier");

  const { data: auth, error: authErr } = await sb.auth.signInWithPassword({
    email: resolvedEmail as string,
    password: "admin123",
  });
  assert(!authErr && !!auth.session?.access_token, "Supabase GoTrue password grant returns valid session");

  const supabaseAccessToken = auth.session!.access_token;
  const sbUser = await resolveUserFromToken(supabaseAccessToken);
  assert(sbUser !== null, "Supabase access token successfully resolves ERP user profile");
  assert(sbUser?.id === 1, "Supabase token maps to user ID 1 in public.users");
  assert(sbUser?.username === "admin", "Resolved user username matches 'admin'");
  assert(sbUser?.isSuperAdmin === true, "Resolved Supabase admin has isSuperAdmin=true");
  assert(Array.isArray(sbUser?.memberships) && sbUser.memberships.length >= 3, "SuperAdmin has multi-company memberships (Pune, Delhi, Rika)");

  // ---------------------------------------------------------------------------
  // Part 3: Live Express middleware pipeline integration
  // ---------------------------------------------------------------------------
  console.log("\n--- PART 3: Express Middleware & HTTP Response Verification ---");

  const app = express();
  app.use(express.json());

  // Test endpoints matching the production router
  app.get("/api/whatsapp/status", authenticateToken, (req: AuthRequest, res: Response) => {
    res.json({
      status: "ok",
      userId: req.user?.id,
      companyId: req.companyId,
      companyRole: req.companyRole,
      isSuperAdmin: req.user?.isSuperAdmin,
    });
  });

  app.post("/api/automation/telegram/test", authenticateToken, requireRole(["admin"]), (req: AuthRequest, res: Response) => {
    res.json({ ok: true, admin: req.user?.username });
  });

  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 3.1 Unauthenticated request -> 401 Access token required
    const unauthRes = await fetch(`${baseUrl}/api/whatsapp/status`);
    assert(unauthRes.status === 401, "Unauthenticated request returns HTTP 401");
    const unauthBody = await unauthRes.json();
    assert(unauthBody.message === "Access token required", "Unauthenticated request returns 'Access token required'");

    // 3.2 Bearer null -> 401 Access token required
    const bearerNullRes = await fetch(`${baseUrl}/api/whatsapp/status`, {
      headers: { Authorization: "Bearer null" },
    });
    assert(bearerNullRes.status === 401, "Bearer null returns HTTP 401");

    // 3.3 Invalid token -> 401 Invalid token
    const invalidTokenRes = await fetch(`${baseUrl}/api/whatsapp/status`, {
      headers: { Authorization: "Bearer totally_bogus_token" },
    });
    assert(invalidTokenRes.status === 401, "Bogus token returns HTTP 401");
    const invalidBody = await invalidTokenRes.json();
    assert(invalidBody.message === "Invalid token", "Bogus token returns 'Invalid token'");

    // 3.4 Local Express token -> 200 OK
    const localHttpRes = await fetch(`${baseUrl}/api/whatsapp/status`, {
      headers: {
        Authorization: `Bearer ${localToken}`,
        "X-Company-Id": "1",
      },
    });
    assert(localHttpRes.status === 200, "Express JWT request returns HTTP 200");
    const localHttpBody = await localHttpRes.json();
    assert(localHttpBody.userId === 1 && localHttpBody.companyId === 1, "Express JWT correctly sets userId=1 and companyId=1");

    // 3.5 Real Supabase Auth access token -> 200 OK
    const sbHttpRes = await fetch(`${baseUrl}/api/whatsapp/status`, {
      headers: {
        Authorization: `Bearer ${supabaseAccessToken}`,
        "X-Company-Id": "1",
      },
    });
    assert(sbHttpRes.status === 200, "Supabase Auth access token returns HTTP 200");
    const sbHttpBody = await sbHttpRes.json();
    assert(sbHttpBody.userId === 1, "Supabase token authenticated user ID matches 1");
    assert(sbHttpBody.isSuperAdmin === true, "Supabase token authenticated user is recognized as superAdmin");

    // 3.6 Multi-company switching via X-Company-Id for SuperAdmin
    const company2Res = await fetch(`${baseUrl}/api/whatsapp/status`, {
      headers: {
        Authorization: `Bearer ${supabaseAccessToken}`,
        "X-Company-Id": "2",
      },
    });
    assert(company2Res.status === 200, "SuperAdmin can access Delhi Company (Company 2)");
    const company2Body = await company2Res.json();
    assert(company2Body.companyId === 2, "X-Company-Id 2 correctly set on request context");

    const company3Res = await fetch(`${baseUrl}/api/whatsapp/status`, {
      headers: {
        Authorization: `Bearer ${supabaseAccessToken}`,
        "X-Company-Id": "3",
      },
    });
    assert(company3Res.status === 200, "SuperAdmin can access Rika Store (Company 3)");
    const company3Body = await company3Res.json();
    assert(company3Body.companyId === 3, "X-Company-Id 3 correctly set on request context");

    // 3.7 Non-super admin restricted to assigned company
    const restrictedToken = jwt.sign({ id: 5, username: "rika_user", role: "staff" }, JWT_SECRET);
    const unauthCompanyRes = await fetch(`${baseUrl}/api/whatsapp/status`, {
      headers: {
        Authorization: `Bearer ${restrictedToken}`,
        "X-Company-Id": "1", // Not authorized for Company 1
      },
    });
    assert(unauthCompanyRes.status === 403, "Restricted user access to unauthorized company returns HTTP 403 Forbidden");

    // 3.8 Role-based access control
    const forbiddenRes = await fetch(`${baseUrl}/api/automation/telegram/test`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${restrictedToken}`,
      },
    });
    assert(forbiddenRes.status === 403, "Non-admin user blocked from admin endpoint with HTTP 403");

    const allowedAdminRes = await fetch(`${baseUrl}/api/automation/telegram/test`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${supabaseAccessToken}`,
      },
    });
    assert(allowedAdminRes.status === 200, "Admin user with Supabase token permitted on admin endpoint with HTTP 200");

  } finally {
    server.close();
  }

  console.log("\n=================================================");
  console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("=================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runAuthRegressionTests()
  .catch((err) => {
    console.error("FATAL ERROR in test execution:", err);
    process.exit(1);
  })
  .finally(() => {
    pool.end().catch(() => {});
  });
