import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import { registerRoutes } from "../server/routes";
import { generateToken } from "../server/auth";
import { db } from "../server/db";
import { notifications, users, companyUsers } from "../shared/schema";
import { eq, sql, and, isNull } from "drizzle-orm";
import assert from "assert";

async function runNotificationsRegressionSuite() {
  console.log("======================================================================");
  console.log("  RUNNING NOTIFICATIONS 'MARK AS READ' & 'MARK ALL AS READ' TESTS");
  console.log("======================================================================");

  // Initialize Express app with routes
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  await registerRoutes(app);

  const server = app.listen(0);
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`Test server running on ${baseUrl}`);

  try {
    // User 1: Admin (ID: 1, Company 1)
    const [adminUser] = await db.select().from(users).where(eq(users.id, 1)).limit(1);
    assert(adminUser, "User 1 (Admin) must exist");

    // User 2: Another active user with Company 1 membership (e.g. qa_manager id 2)
    const [secondaryUser] = await db.select().from(users).where(eq(users.id, 2)).limit(1);
    assert(secondaryUser, "User 2 (qa_manager) must exist for company 1 multi-user testing");

    // User 3: User restricted to Company 2 (e.g. pinks id 12)
    const [c2User] = await db.select().from(users).where(eq(users.id, 12)).limit(1);
    assert(c2User, "User 12 (pinks) must exist for company 2 boundary testing");

    const tokenUser1 = generateToken({ id: adminUser.id, username: adminUser.username, role: adminUser.role });
    const tokenUser2 = generateToken({ id: secondaryUser.id, username: secondaryUser.username, role: secondaryUser.role });
    const tokenC2User = generateToken({ id: c2User.id, username: c2User.username, role: c2User.role });

    console.log(`User 1: ${adminUser.username} (ID: ${adminUser.id}, Role: ${adminUser.role}) - Company 1`);
    console.log(`User 2: ${secondaryUser.username} (ID: ${secondaryUser.id}, Role: ${secondaryUser.role}) - Company 1`);
    console.log(`User 3: ${c2User.username} (ID: ${c2User.id}, Role: ${c2User.role}) - Company 2`);

    // Backup current state of all open notifications in Company 1 so we can cleanly restore
    const originalOpenNotifications = await db.select({
      id: notifications.id,
      readBy: notifications.readBy,
    }).from(notifications).where(and(
      isNull(notifications.resolvedAt),
      eq(notifications.companyId, 1)
    ));

    console.log(`Found ${originalOpenNotifications.length} open notifications in Company 1.`);
    assert(originalOpenNotifications.length >= 2, "Need at least 2 open notifications in company 1 for testing");

    const targetNotif1 = originalOpenNotifications[0];
    const targetNotif2 = originalOpenNotifications[1];

    // Ensure targetNotif1 starts unread for both users for clean testing
    await db.execute(sql`
      UPDATE notifications
      SET read_by = (
        SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
        FROM jsonb_array_elements(COALESCE(read_by, '[]'::jsonb)) elem
        WHERE elem::int NOT IN (${adminUser.id}, ${secondaryUser.id})
      )
      WHERE id IN (${targetNotif1.id}, ${targetNotif2.id})
    `);

    // ─────────────────────────────────────────────────────────────────
    // Test 1: GET /api/notifications returns company 1 notifications
    // ─────────────────────────────────────────────────────────────────
    console.log("\n[Test 1] Testing GET /api/notifications for Company 1...");
    const resGet1 = await fetch(`${baseUrl}/api/notifications`, {
      headers: { Authorization: `Bearer ${tokenUser1}`, "X-Company-Id": "1" },
    });
    assert.strictEqual(resGet1.status, 200, "GET /api/notifications should return 200");
    const list1 = await resGet1.json();
    assert(Array.isArray(list1), "Response should be an array");
    const item1 = list1.find((n: any) => n.id === targetNotif1.id);
    const item2 = list1.find((n: any) => n.id === targetNotif2.id);

    assert(item1, `Notification ${targetNotif1.id} should be in GET list`);
    assert(item2, `Notification ${targetNotif2.id} should be in GET list`);
    assert.strictEqual(item1.read, false, "Notification 1 should be unread for User 1 initially");
    assert.strictEqual(item2.read, false, "Notification 2 should be unread for User 1 initially");
    console.log("  ✓ PASS: GET /api/notifications returns scoped notifications with unread status.");

    // ─────────────────────────────────────────────────────────────────
    // Test 2: Mark individual notification as read
    // ─────────────────────────────────────────────────────────────────
    console.log("\n[Test 2] Testing individual mark as read (POST /api/notifications/:id/read)...");
    const resRead1 = await fetch(`${baseUrl}/api/notifications/${targetNotif1.id}/read`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenUser1}`,
        "X-Company-Id": "1",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ read: true }),
    });
    assert.strictEqual(resRead1.status, 200, "Mark as read should return 200");
    const readResp = await resRead1.json();
    assert.strictEqual(readResp.ok, true, "Response should have ok: true");
    assert.strictEqual(readResp.read, true, "Response should have read: true");

    // Verify in GET /api/notifications for User 1
    const resGetAfterRead = await fetch(`${baseUrl}/api/notifications`, {
      headers: { Authorization: `Bearer ${tokenUser1}`, "X-Company-Id": "1" },
    });
    const listAfterRead = await resGetAfterRead.json();
    const item1AfterRead = listAfterRead.find((n: any) => n.id === targetNotif1.id);
    const item2AfterRead = listAfterRead.find((n: any) => n.id === targetNotif2.id);
    assert.strictEqual(item1AfterRead.read, true, "Notification 1 must now have read = true for User 1");
    assert.strictEqual(item2AfterRead.read, false, "Notification 2 must still have read = false for User 1");
    console.log("  ✓ PASS: Individual notification marked as read and reflected in user 1's list.");

    // ─────────────────────────────────────────────────────────────────
    // Test 3: Multi-User Isolation (User 2 still sees it as unread!)
    // ─────────────────────────────────────────────────────────────────
    console.log("\n[Test 3] Verifying Multi-User Isolation: User 2 must still see notification 1 as UNREAD...");
    const resGetU2 = await fetch(`${baseUrl}/api/notifications`, {
      headers: { Authorization: `Bearer ${tokenUser2}`, "X-Company-Id": "1" },
    });
    const listU2 = await resGetU2.json();
    const item1U2 = listU2.find((n: any) => n.id === targetNotif1.id);
    assert(item1U2, `Notification 1 should be visible to User 2`);
    assert.strictEqual(item1U2.read, false, "CRITICAL: Notification 1 must remain UNREAD for User 2!");
    console.log("  ✓ PASS: Multi-user isolation verified! User 1 marking as read did not affect User 2.");

    // ─────────────────────────────────────────────────────────────────
    // Test 4: Toggle read status back to unread
    // ─────────────────────────────────────────────────────────────────
    console.log("\n[Test 4] Testing mark as unread (toggle)...");
    const resUnread1 = await fetch(`${baseUrl}/api/notifications/${targetNotif1.id}/read`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenUser1}`,
        "X-Company-Id": "1",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ read: false }),
    });
    assert.strictEqual(resUnread1.status, 200, "Mark as unread should return 200");
    const unreadResp = await resUnread1.json();
    assert.strictEqual(unreadResp.read, false, "Response should have read: false");

    // Verify in GET
    const resGetAfterUnread = await fetch(`${baseUrl}/api/notifications`, {
      headers: { Authorization: `Bearer ${tokenUser1}`, "X-Company-Id": "1" },
    });
    const listAfterUnread = await resGetAfterUnread.json();
    const item1AfterUnread = listAfterUnread.find((n: any) => n.id === targetNotif1.id);
    assert.strictEqual(item1AfterUnread.read, false, "Notification 1 must now be unread for User 1");
    console.log("  ✓ PASS: Toggle to unread works cleanly.");

    // ─────────────────────────────────────────────────────────────────
    // Test 5: Mark all as read (POST /api/notifications/read-all)
    // ─────────────────────────────────────────────────────────────────
    console.log("\n[Test 5] Testing Mark All as Read (POST /api/notifications/read-all)...");
    const resReadAll = await fetch(`${baseUrl}/api/notifications/read-all`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenUser1}`,
        "X-Company-Id": "1",
      },
    });
    assert.strictEqual(resReadAll.status, 200, "Mark all as read should return 200");
    const readAllResp = await resReadAll.json();
    assert.strictEqual(readAllResp.ok, true, "Response should have ok: true");
    assert(typeof readAllResp.count === "number", "Response should include count");
    console.log(`  Updated count: ${readAllResp.count}`);

    // Verify unread count is now 0 for User 1
    const resGetAfterAll = await fetch(`${baseUrl}/api/notifications`, {
      headers: { Authorization: `Bearer ${tokenUser1}`, "X-Company-Id": "1" },
    });
    const listAfterAll = await resGetAfterAll.json();
    const unreadUser1 = listAfterAll.filter((n: any) => !n.read).length;
    assert.strictEqual(unreadUser1, 0, `All notifications must be marked read for User 1! Found ${unreadUser1} unread`);
    console.log("  ✓ PASS: Mark all as read marked all company 1 notifications as read for User 1 (0 unread).");

    // Verify User 2's unread count is still non-zero (User 2 was NOT marked read by User 1's action!)
    const resGetU2AfterAll = await fetch(`${baseUrl}/api/notifications`, {
      headers: { Authorization: `Bearer ${tokenUser2}`, "X-Company-Id": "1" },
    });
    const listU2AfterAll = await resGetU2AfterAll.json();
    const unreadUser2 = listU2AfterAll.filter((n: any) => !n.read).length;
    assert(unreadUser2 > 0, `User 2 must still have unread notifications! Found ${unreadUser2}`);
    console.log(`  ✓ PASS: Multi-user isolation maintained after Mark All as Read (User 2 has ${unreadUser2} unread).`);

    // ─────────────────────────────────────────────────────────────────
    // Test 6: Persistence verification across fresh request & DB check
    // ─────────────────────────────────────────────────────────────────
    console.log("\n[Test 6] Verifying database persistence across session/request...");
    const [persistedRow1] = await db.select().from(notifications).where(eq(notifications.id, targetNotif1.id)).limit(1);
    const p1ReadBy = Array.isArray(persistedRow1.readBy) ? persistedRow1.readBy : [];
    assert(p1ReadBy.includes(adminUser.id), "User 1's ID must be persistently stored in Postgres notifications.read_by");
    console.log("  ✓ PASS: Read status is persisted directly in PostgreSQL JSONB column 'read_by'.");

    // ─────────────────────────────────────────────────────────────────
    // Test 7: Multi-Company Workspace Boundary Isolation
    // ─────────────────────────────────────────────────────────────────
    console.log("\n[Test 7] Verifying Multi-Company Workspace Boundaries...");
    // 7.1: User 3 (Company 2) attempting to read Company 1 notifications must be rejected with 403
    const resC2Forbidden = await fetch(`${baseUrl}/api/notifications`, {
      headers: { Authorization: `Bearer ${tokenC2User}`, "X-Company-Id": "1" },
    });
    assert.strictEqual(resC2Forbidden.status, 403, "Company 2 user must receive 403 when querying Company 1 notifications");

    // 7.2: User 3 attempting to mark Company 1 notification as read must be rejected with 403
    const resC2MarkForbidden = await fetch(`${baseUrl}/api/notifications/${targetNotif1.id}/read`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenC2User}`,
        "X-Company-Id": "2",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ read: true }),
    });
    assert.strictEqual(resC2MarkForbidden.status, 403, "Company 2 user must receive 403 when marking Company 1 notification");

    // 7.3: User 3 accessing their authorized workspace (Company 2) succeeds
    const resC2Success = await fetch(`${baseUrl}/api/notifications`, {
      headers: { Authorization: `Bearer ${tokenC2User}`, "X-Company-Id": "2" },
    });
    assert.strictEqual(resC2Success.status, 200, "Company 2 user can access Company 2 notifications");
    const listC2 = await resC2Success.json();
    assert(Array.isArray(listC2), "Company 2 notifications must be an array");
    console.log("  ✓ PASS: Multi-company isolation verified: 403 on cross-company access, clean workspace boundaries.");

    // ─────────────────────────────────────────────────────────────────
    // Restore original notifications states
    // ─────────────────────────────────────────────────────────────────
    console.log("\nRestoring original notifications states...");
    await Promise.all(originalOpenNotifications.map((orig) =>
      db.update(notifications).set({
        readBy: orig.readBy || [],
      }).where(eq(notifications.id, orig.id))
    ));
    console.log("Original states restored.");

    console.log("\n======================================================================");
    console.log("  ALL NOTIFICATION TESTS PASSED SUCCESSFULLY! (100% PASS RATE)");
    console.log("======================================================================");
    server.close(() => {
      process.exit(0);
    });
  } catch (err) {
    server.close();
    throw err;
  }
}

runNotificationsRegressionSuite().catch((err) => {
  console.error("FATAL TEST FAILURE:", err);
  process.exit(1);
});
