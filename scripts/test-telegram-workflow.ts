import { db, pool } from "../server/db";
import {
  botSettings,
  botUploadInbox,
  webhookLogs,
  users,
  estimates,
  clients,
  fieldAccessLinks,
  executionDocuments,
  companies,
  companyUsers,
} from "../shared/schema";
import {
  handleTelegramWebhook,
  getTelegramSettings,
  saveTelegramSettings,
  getUserAssignedProjects,
  assignProjectToTelegramUser,
  revokeProjectAssignment,
  getCompanyTelegramApprover,
  setCompanyTelegramApprover,
  unlinkCompanyTelegramApprover,
  testCompanyTelegramApprover,
} from "../server/telegram";
import { eq, sql } from "drizzle-orm";
import path from "path";
import fs from "fs";

process.env.TELEGRAM_MOCK = "1";

async function runTelegramWorkflowTests() {
  console.log("=================================================");
  console.log("SUNRISE MEDIA ERP — TELEGRAM BOT WORKFLOW TESTS");
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

  const uploadDir = path.join(process.cwd(), "uploads");
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

  const testAdminChatId = `admin_${Date.now()}`;
  const testStaffChatId = `staff_${Date.now()}`;
  const testStaffPhone = "+919876543210";
  const testStaffName = "Test Ramesh Installer";

  try {
    // 0. Setup: Ensure bot is enabled and Admin Chat ID is configured
    console.log("Setup: Configure Telegram Bot Settings and Admin Chat ID");
    await saveTelegramSettings({
      enabled: true,
      botUsername: "SunriseMediaTestBot",
      adminChatId: testAdminChatId,
      adminChatVerified: true,
      accessRequests: [],
    });
    const config = await getTelegramSettings();
    assert(config.enabled === true, "Bot settings enabled");
    assert(config.adminChatId === testAdminChatId, "Admin chat ID persisted");

    // Ensure a test estimate exists for testing project assignment
    let [testEstimate] = await db.select().from(estimates).limit(1);
    if (!testEstimate) {
      const [testClient] = await db
        .insert(clients)
        .values({
          name: "Telegram Test Client",
          companyId: 1,
        })
        .returning();

      const [newEstimate] = await db
        .insert(estimates)
        .values({
          estimateNumber: `SM/TEST/TG/${Date.now()}`,
          title: "Telegram Evidence Test Project",
          clientId: testClient.id,
          companyId: 1,
          status: "approved",
        })
        .returning();
      testEstimate = newEstimate;
    }
    assert(!!testEstimate, `Active test estimate available: ${testEstimate.estimateNumber}`);

    // TEST 1: Unknown user sends /start -> must prompt for contact sharing
    console.log("\nTest 1: Unknown User sends /start");
    const startPayload = {
      update_id: 100001,
      message: {
        message_id: 1,
        from: { id: parseInt(testStaffChatId.replace("staff_", "") || "99999", 10), first_name: "Ramesh" },
        chat: { id: testStaffChatId, type: "private" },
        text: "/start",
        date: Math.floor(Date.now() / 1000),
      },
    };
    const startRes = await handleTelegramWebhook(startPayload, uploadDir);
    assert(startRes.handled === true && startRes.action === "start_prompt_contact", "Prompted unknown user to share contact");

    // TEST 2: Forged contact (contact.user_id !== from.id) must be rejected
    console.log("\nTest 2: Forged contact sharing is rejected");
    const forgedContactPayload = {
      update_id: 100002,
      message: {
        message_id: 2,
        from: { id: 88888, first_name: "Ramesh" },
        chat: { id: testStaffChatId, type: "private" },
        contact: {
          phone_number: testStaffPhone,
          first_name: "Ramesh",
          user_id: 77777, // differs from from.id!
        },
        date: Math.floor(Date.now() / 1000),
      },
    };
    const forgedRes = await handleTelegramWebhook(forgedContactPayload, uploadDir);
    assert(forgedRes.handled === true && forgedRes.action === "contact_forged_rejected", "Forged contact rejected with security notice");

    // TEST 3: Genuine contact sharing creates pending request and notifies admin
    console.log("\nTest 3: Authentic contact sharing creates pending access request");
    const validContactPayload = {
      update_id: 100003,
      message: {
        message_id: 3,
        from: { id: 88888, first_name: "Ramesh", username: "ramesh_installer" },
        chat: { id: testStaffChatId, type: "private" },
        contact: {
          phone_number: testStaffPhone,
          first_name: "Ramesh",
          last_name: "Installer",
          user_id: 88888, // Matches from.id!
        },
        date: Math.floor(Date.now() / 1000),
      },
    };
    const contactRes = await handleTelegramWebhook(validContactPayload, uploadDir);
    assert(contactRes.handled === true && contactRes.action === "access_requested", "Access request recorded for authentic contact");

    const confAfterReq = await getTelegramSettings();
    const pendingReq = confAfterReq.accessRequests.find((r) => r.chatId === testStaffChatId);
    assert(!!pendingReq && pendingReq.status === "pending", "Request saved as pending in settings");

    // TEST 4: Pending user cannot view projects or upload evidence
    console.log("\nTest 4: Pending user blocked from project access and upload");
    const pendingStartRes = await handleTelegramWebhook({
      update_id: 100004,
      message: {
        message_id: 4,
        from: { id: 88888 },
        chat: { id: testStaffChatId, type: "private" },
        text: "/projects",
      },
    }, uploadDir);
    assert(pendingStartRes.action === "projects_unauthorized", "Pending user rejected from viewing projects");

    const pendingUploadRes = await handleTelegramWebhook({
      update_id: 100005,
      message: {
        message_id: 5,
        from: { id: 88888 },
        chat: { id: testStaffChatId, type: "private" },
        photo: [{ file_id: "photo_test_1", width: 100, height: 100 }],
      },
    }, uploadDir);
    assert(pendingUploadRes.action === "upload_rejected_unapproved", "Pending user blocked from uploading photo evidence");

    // TEST 5: Unauthorized non-admin cannot approve request
    console.log("\nTest 5: Unauthorized non-admin callback rejected");
    const unauthorizedCallback = {
      update_id: 100006,
      callback_query: {
        id: "cb_unauth",
        from: { id: 99999999 }, // not admin
        message: { message_id: 10 },
        data: `auth:approve:${testStaffChatId}`,
      },
    };
    const unauthRes = await handleTelegramWebhook(unauthorizedCallback, uploadDir);
    assert(unauthRes.action === "auth_callback_unauthorized", "Non-admin approval callback rejected");

    // TEST 6: Configured administrator approves request
    console.log("\nTest 6: Configured admin approves request");
    const adminApproveCallback = {
      update_id: 100007,
      callback_query: {
        id: "cb_admin_approve",
        from: { id: testAdminChatId }, // Matches configured admin!
        message: { message_id: 11 },
        data: `auth:approve:${testStaffChatId}`,
      },
    };
    const adminApproveRes = await handleTelegramWebhook(adminApproveCallback, uploadDir);
    assert(adminApproveRes.action === "approved_user", "Admin approved user successfully");

    // Verify user record in database
    const [approvedUser] = await db.select().from(users).where(eq(users.telegramChatId, testStaffChatId)).limit(1);
    assert(!!approvedUser && approvedUser.isActive === true, "User registered and active in users table");

    // TEST 7: Approved user with 0 assigned projects sees no projects
    console.log("\nTest 7: Approved contact still sees no projects until assigned");
    const approvedProjectsRes = await handleTelegramWebhook({
      update_id: 100008,
      message: {
        message_id: 8,
        from: { id: 88888 },
        chat: { id: testStaffChatId, type: "private" },
        text: "/projects",
      },
    }, uploadDir);
    assert(approvedProjectsRes.action === "projects_none", "Approved user sees no projects before assignment");

    // TEST 8: Administrator assigns project to user in ERP
    console.log("\nTest 8: Administrator assigns project to user");
    const assignmentLink = await assignProjectToTelegramUser({
      userId: approvedUser.id,
      estimateId: testEstimate.id,
    });
    assert(!!assignmentLink && assignmentLink.estimateId === testEstimate.id, "Project assigned via fieldAccessLinks");

    const assignedProjects = await getUserAssignedProjects(testStaffChatId);
    assert(assignedProjects.length === 1 && assignedProjects[0].estimateId === testEstimate.id, "Assigned project returned for user");

    // TEST 9: User selects assigned project and initiates upload
    console.log("\nTest 9: User selects assigned project");
    const selectProjectCb = {
      update_id: 100009,
      callback_query: {
        id: "cb_proj_select",
        from: { id: testStaffChatId },
        message: { message_id: 20 },
        data: `proj:${testEstimate.id}`,
      },
    };
    const selectProjRes = await handleTelegramWebhook(selectProjectCb, uploadDir);
    assert(selectProjRes.action === "project_selected", "Project selected and category menu shown");

    // Select category: Installation Photos
    const selectCategoryCb = {
      update_id: 100010,
      callback_query: {
        id: "cb_cat_select",
        from: { id: testStaffChatId },
        message: { message_id: 21 },
        data: `up:photo:${testEstimate.id}`,
      },
    };
    const selectCatRes = await handleTelegramWebhook(selectCategoryCb, uploadDir);
    assert(selectCatRes.action === "upload_category_selected", "Upload category selected and ready for photos");

    // TEST 10: Upload photo evidence and verify DB linkage
    console.log("\nTest 10: Upload installation photo and verify executionDocuments & botUploadInbox");
    const photoUploadPayload = {
      update_id: 100011,
      message: {
        message_id: 30,
        from: { id: 88888 },
        chat: { id: testStaffChatId, type: "private" },
        caption: "Main fascia signage installed with backlights",
        photo: [
          { file_id: "test_photo_low", width: 100, height: 100 },
          { file_id: "test_photo_high", width: 800, height: 800 },
        ],
        date: Math.floor(Date.now() / 1000),
      },
    };
    const photoUploadRes = await handleTelegramWebhook(photoUploadPayload, uploadDir);
    assert(photoUploadRes.action === "upload_saved", "Installation photo saved");

    // Verify row in executionDocuments
    const [execDoc] = await db
      .select()
      .from(executionDocuments)
      .where(sql`${executionDocuments.estimateId} = ${testEstimate.id} AND ${executionDocuments.uploadedVia} = 'telegram'`)
      .orderBy(sql`${executionDocuments.id} DESC`)
      .limit(1);

    assert(!!execDoc, "Photo saved in executionDocuments table");
    assert(execDoc.documentType === "photo", "Document category is photo");
    assert(execDoc.estimateId === testEstimate.id, "Document linked to correct estimate");

    // Verify row in botUploadInbox
    const [inboxRow] = await db
      .select()
      .from(botUploadInbox)
      .where(sql`${botUploadInbox.mappedEstimateId} = ${testEstimate.id} AND ${botUploadInbox.source} = 'telegram'`)
      .orderBy(sql`${botUploadInbox.id} DESC`)
      .limit(1);

    assert(!!inboxRow, "Row created in botUploadInbox");
    assert(inboxRow.status === "mapped", "Inbox item status is mapped");
    assert(inboxRow.mappedEstimateId === testEstimate.id, "Inbox item mapped to correct estimate");

    // TEST 11: Webhook deduplication ignores duplicate update_id
    console.log("\nTest 11: Duplicate webhook delivery is ignored");
    const dupRes = await handleTelegramWebhook(photoUploadPayload, uploadDir);
    assert(dupRes.action === "duplicate_ignored", "Duplicate update_id ignored without re-inserting");

    // TEST 12: Revoked assignment stops future uploads
    console.log("\nTest 12: Revoked access stops future uploads");
    await revokeProjectAssignment(assignmentLink.id);

    const postRevokeUploadRes = await handleTelegramWebhook({
      update_id: 100012,
      message: {
        message_id: 35,
        from: { id: 88888 },
        chat: { id: testStaffChatId, type: "private" },
        photo: [{ file_id: "test_photo_post_revoke", width: 100, height: 100 }],
      },
    }, uploadDir);
    assert(postRevokeUploadRes.action === "upload_rejected_revoked", "Upload rejected after project assignment revoked");

    // TEST 13: Company isolation check
    console.log("\nTest 13: Multi-company isolation");
    assert(execDoc.companyId === (testEstimate.companyId || 1), "Document company matches estimate company");
    assert(inboxRow.companyId === (testEstimate.companyId || 1), "Inbox company matches estimate company");

    // ─────────────────────────────────────────────────────────────
    // TESTS 14-19: Company Workspace Telegram Approver Flow
    // ─────────────────────────────────────────────────────────────
    console.log("\nTest 14: Company Telegram Approver Setup & International Phone Validation");
    await unlinkCompanyTelegramApprover(1);

    // Invalid phone rejection
    let invalidPhoneRejected = false;
    try {
      await setCompanyTelegramApprover(1, "08123456789");
    } catch {
      invalidPhoneRejected = true;
    }
    assert(invalidPhoneRejected, "Invalid phone number without '+' international code rejected");

    // Valid international phone configuration (e.g. +62 Indonesian format or +91 Indian format)
    const testAdminPhone = `+62812${Date.now().toString().slice(-7)}`;
    const approverConfig = await setCompanyTelegramApprover(1, testAdminPhone);
    assert(approverConfig.phone === testAdminPhone, "Approver international phone saved");
    assert(approverConfig.status === "awaiting_link", "Approver status set to awaiting_link");
    assert(!!approverConfig.linkCode, "Unique workspace linkCode generated");

    // Test 15: Admin links account via /start link_<code/token>
    console.log("\nTest 15: Company Approver Account Linking via /start link_<code/token>");
    const companyAdminChatId = `comp_admin_${Date.now()}`;
    const linkRes = await handleTelegramWebhook({
      update_id: 100014,
      message: {
        message_id: 40,
        from: { id: Number(companyAdminChatId.replace(/\D/g, "").slice(0, 8)) || 777777, username: "company_admin_tg", first_name: "Workspace", last_name: "Admin" },
        chat: { id: companyAdminChatId, type: "private" },
        text: `/start link_${approverConfig.linkCode}`,
      },
    }, uploadDir);

    assert(linkRes.action === "approver_linked", "Telegram account linked via /start linkCode");
    const verifiedApprover = await getCompanyTelegramApprover(1);
    assert(verifiedApprover.status === "verified", "Company approver status transitioned to verified");
    assert(verifiedApprover.chatId === companyAdminChatId, "Verified approver chatId stored in company settings");
    assert(verifiedApprover.linkCode === null, "One-time linkCode cleared after verification");

    // Test 16: Test Notification Action
    console.log("\nTest 16: Verified Approver Test Notification Action");
    const testNotifRes = await testCompanyTelegramApprover(1);
    assert(testNotifRes.ok === true, "Test notification action succeeded for verified approver");
    const testedApprover = await getCompanyTelegramApprover(1);
    assert(!!testedApprover.lastTestedAt, "lastTestedAt timestamp updated in settings");

    // Test 17: Access Request Notifies Company Approver & Validates Callback Identity
    console.log("\nTest 17: Access Request Routing to Company Approver & Identity Validation");
    const newWorkerChatId = `worker_${Date.now()}`;
    const newWorkerPhone = "+919123456780";
    const workerContactRes = await handleTelegramWebhook({
      update_id: 100015,
      message: {
        message_id: 42,
        from: { id: 99999, first_name: "Rohit", last_name: "Fieldman" },
        chat: { id: newWorkerChatId, type: "private" },
        contact: {
          phone_number: newWorkerPhone,
          first_name: "Rohit",
          last_name: "Fieldman",
          user_id: 99999,
        },
      },
    }, uploadDir);
    assert(workerContactRes.action === "access_requested", "Worker contact submission created access request");

    // Forged non-approver attempts to approve
    const forgedCallbackRes = await handleTelegramWebhook({
      update_id: 100016,
      callback_query: {
        id: "cb_forged_999",
        from: { id: 111222 }, // random unconfigured identity
        data: `auth:approve:${newWorkerChatId}:1`,
      },
    }, uploadDir);
    assert(forgedCallbackRes.action === "auth_callback_unauthorized", "Server rejects forged/unauthorized approval callback");

    // Verified company approver approves request
    const validCallbackRes = await handleTelegramWebhook({
      update_id: 100017,
      callback_query: {
        id: "cb_valid_1000",
        from: { id: companyAdminChatId },
        data: `auth:approve:${newWorkerChatId}:1`,
      },
    }, uploadDir);
    assert(validCallbackRes.action === "approved_user", "Server accepts callback from verified company approver");

    // Test 18: Unlinking Approver
    console.log("\nTest 18: Company Approver Unlinking");
    const unlinkedApprover = await unlinkCompanyTelegramApprover(1);
    assert(unlinkedApprover.status === "not_configured", "Approver status reset to not_configured after unlink");
    assert(unlinkedApprover.chatId === null, "chatId cleared after unlink");

    // Test 19: Multi-Company Approver Isolation
    console.log("\nTest 19: Multi-Company Approver Isolation");
    const comp2Config = await setCompanyTelegramApprover(2, "+919999888877");
    const comp1Check = await getCompanyTelegramApprover(1);
    assert(comp2Config.phone === "+919999888877", "Company 2 approver configured independently");
    assert(comp1Check.status === "not_configured", "Company 1 approver remains isolated and untouched");

    // Clean up worker test user
    await db.delete(users).where(eq(users.telegramChatId, newWorkerChatId)).catch(() => {});
    await unlinkCompanyTelegramApprover(2).catch(() => {});

    console.log(`\n=================================================`);
    console.log(`RESULTS: ${passed} passed, ${failed} failed`);
    console.log(`=================================================`);

    // Clean up test data
    if (inboxRow) await db.delete(botUploadInbox).where(eq(botUploadInbox.id, inboxRow.id)).catch(() => {});
    if (execDoc) await db.delete(executionDocuments).where(eq(executionDocuments.id, execDoc.id)).catch(() => {});
    if (approvedUser) {
      await db.delete(executionDocuments).where(eq(executionDocuments.uploadedBy, approvedUser.id)).catch(() => {});
      await db.delete(companyUsers).where(eq(companyUsers.userId, approvedUser.id)).catch(() => {});
      await db.delete(fieldAccessLinks).where(eq(fieldAccessLinks.assignedTo, approvedUser.id)).catch(() => {});
      await db.delete(users).where(eq(users.id, approvedUser.id)).catch(() => {});
    }

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error("Test failed with exception:", err);
    process.exit(1);
  } finally {
    try {
      pool.end().catch(() => {});
    } catch {}
    process.exit(failed > 0 ? 1 : 0);
  }
}

runTelegramWorkflowTests();
