import { db, pool } from "../server/db";
import {
  users,
  companyUsers,
  companies,
  fieldAccessLinks,
  estimates,
  clients,
  botSettings,
  botUploadInbox,
  executionDocuments,
  webhookLogs,
} from "../shared/schema";
import {
  installerService,
  normalizePhoneE164,
  cleanPhoneLast10,
} from "../server/services/installerService";
import { whatsappEvolution } from "../server/services/whatsappEvolution";
import { eq, sql } from "drizzle-orm";
import path from "path";
import fs from "fs";

process.env.WHATSAPP_MOCK = "1";

async function runInstallerWorkflowTests() {
  console.log("=================================================");
  console.log("SUNRISE MEDIA ERP — UNIFIED INSTALLER & WHATSAPP TESTS");
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

  const testCompanyId = 1;
  const testPhoneRaw = "98" + String(Date.now()).slice(-8);
  const testPhoneE164 = `+91${testPhoneRaw}`;
  const testName = `Ramesh Installer Test ${Date.now()}`;

  try {
    // TEST 1: Phone Normalization (E.164)
    console.log("--- PART A1: Phone Normalization & Contact Directory ---");
    assert(normalizePhoneE164("98236 33833") === "+919823633833", "10-digit Indian phone normalized with +91");
    assert(normalizePhoneE164("+91 98236 33833") === "+919823633833", "Already prefixed number sanitized without spaces");
    assert(cleanPhoneLast10("+919823633833") === "9823633833", "cleanPhoneLast10 extracts 10 digits");

    // TEST 2: Register Installer Contact via Unified Directory
    console.log("\n--- PART A2: Register & Upsert Installer Contact ---");
    const installer = await installerService.upsertInstaller(testCompanyId, {
      name: testName,
      phone: testPhoneRaw,
      role: "installer",
      notes: "Pune Signage & Acrylic fabrication",
    });
    assert(!!installer && installer.name === testName, "Installer created with correct name");
    assert(installer.phone === testPhoneE164, "Installer phone saved in normalized E.164");
    assert(installer.isActive === true, "Installer active by default");

    // TEST 3: Prevent Duplicate Contact within Company Scope
    console.log("\n--- PART A3: Duplicate Phone Prevention ---");
    let duplicateCaught = false;
    try {
      await installerService.upsertInstaller(testCompanyId, {
        name: "Duplicate Ramesh",
        phone: testPhoneRaw,
        role: "installer",
      });
    } catch (err: any) {
      duplicateCaught = true;
      assert(err.message.includes("already exists with phone number"), "Throws duplicate contact error within company");
    }
    assert(duplicateCaught, "Duplicate contact with same phone blocked within company scope");

    // TEST 4: Searchable Installer Directory
    console.log("\n--- PART A4: Searchable Directory Query ---");
    const searchResults = await installerService.listInstallers(testCompanyId, "Ramesh");
    const found = searchResults.find(i => i.id === installer.id);
    assert(!!found, "Search by name 'Ramesh' locates installer");

    // Ensure a test estimate exists
    let [testEstimate] = await db.select().from(estimates).limit(1);
    if (!testEstimate) {
      const [testClient] = await db
        .insert(clients)
        .values({
          name: "Installer Test Client",
          companyId: testCompanyId,
        })
        .returning();

      const [newEstimate] = await db
        .insert(estimates)
        .values({
          estimateNumber: `SM/TEST/INST/${Date.now()}`,
          title: "Installer Test Project",
          clientId: testClient.id,
          companyId: testCompanyId,
          status: "approved",
        })
        .returning();
      testEstimate = newEstimate;
    }

    // TEST 5: One Assignment For Both Channels (Telegram + WhatsApp)
    console.log("\n--- PART A5: One Assignment, Dual Channels ---");
    const assignment = await installerService.assignProjectToInstaller(testCompanyId, {
      installerId: installer.id,
      estimateId: testEstimate.id,
      allowedStoreCodes: ["STORE-01", "STORE-02"],
    });

    assert(!!assignment, "Project assigned successfully");
    assert(assignment.estimateId === testEstimate.id, "Assignment linked to correct estimate ID");

    // Verify fieldAccessLinks record has channel: 'dual'
    const [linkRecord] = await db
      .select()
      .from(fieldAccessLinks)
      .where(eq(fieldAccessLinks.id, assignment.linkId))
      .limit(1);

    assert(linkRecord.channel === "dual", "Assignment record stored with channel: 'dual'");
    assert(linkRecord.recipientName === testName, "Recipient name preserved on assignment");

    // TEST 6: Dual Channel Project Resolution (WhatsApp and Telegram)
    console.log("\n--- PART A6: Dual Channel Project Resolution ---");
    const waProjects = await whatsappEvolution.getAssignedProjects(testPhoneE164, testCompanyId);
    assert(waProjects.some(p => p.estimateId === testEstimate.id), "WhatsApp project lookup resolves assigned project");

    // TEST 7: WhatsApp Account Verification & Access Approval Flow
    console.log("\n--- PART B0: Inbound WhatsApp First Contact & Access Request ---");
    const remoteJid = `${testPhoneE164.replace(/\D/g, "")}@s.whatsapp.net`;

    const helloPayload = {
      event: "messages.upsert",
      instance: `sunrise_company_${testCompanyId}`,
      data: {
        key: { remoteJid, fromMe: false, id: `MSG_HELLO_${Date.now()}` },
        message: { conversation: "Hello Sunrise ERP" },
        pushName: testName,
      },
    };

    const helloResult = await whatsappEvolution.handleWebhook(helloPayload);
    assert(helloResult.status === "processed" && helloResult.action === "access_requested", "Unverified contact triggers access_requested notice");

    // Administrator approves the WhatsApp access request
    console.log("\n--- PART B1: Administrator Approves WhatsApp Request ---");
    const approval = await whatsappEvolution.approveAccessRequest(testCompanyId, testPhoneE164, "admin_user");
    assert(approval.success === true, "Administrator approves access request");

    const [verifiedUser] = await db.select().from(users).where(eq(users.id, installer.id)).limit(1);
    assert(verifiedUser.whatsappVerified === true, "User marked as verified for WhatsApp");
    assert(verifiedUser.whatsappChatId === remoteJid, "WhatsApp Chat ID linked to user profile");

    // TEST 8: WhatsApp Field Upload Workflow (State Machine & Inbound Messages)
    console.log("\n--- PART B2: WhatsApp Webhook & Project Command ---");
    // Installer sends "projects" command to browse assigned projects
    const projectsPayload = {
      event: "messages.upsert",
      instance: `sunrise_company_${testCompanyId}`,
      data: {
        key: {
          remoteJid,
          fromMe: false,
          id: `MSG_PROJ_${Date.now()}`,
        },
        message: {
          conversation: "projects",
        },
        pushName: testName,
      },
    };

    const projResult = await whatsappEvolution.handleWebhook(projectsPayload);
    assert(projResult.status === "processed", "Projects command processed successfully");

    // Installer selects project "1"
    console.log("\n--- PART B3: WhatsApp Project Selection ---");
    const selectPayload = {
      event: "messages.upsert",
      instance: `sunrise_company_${testCompanyId}`,
      data: {
        key: {
          remoteJid,
          fromMe: false,
          id: `MSG_SEL_${Date.now()}`,
        },
        message: {
          conversation: "1",
        },
        pushName: testName,
      },
    };

    const selResult = await whatsappEvolution.handleWebhook(selectPayload);
    assert(selResult.status === "processed", "Project 1 selected successfully in state engine");

    // Installer selects category "1" (Installation photo)
    console.log("\n--- PART B3: WhatsApp Document Category Selection ---");
    const catPayload = {
      event: "messages.upsert",
      instance: `sunrise_company_${testCompanyId}`,
      data: {
        key: {
          remoteJid,
          fromMe: false,
          id: `MSG_CAT_${Date.now()}`,
        },
        message: {
          conversation: "1",
        },
        pushName: testName,
      },
    };

    const catResult = await whatsappEvolution.handleWebhook(catPayload);
    assert(catResult.status === "processed", "Category 'Installation Photo' selected");

    // Installer uploads an installation photo
    console.log("\n--- PART B4: Inbound Evidence Photo Upload ---");
    const mediaId = `MEDIA_PHOTO_${Date.now()}`;
    const uploadPayload = {
      event: "messages.upsert",
      instance: `sunrise_company_${testCompanyId}`,
      data: {
        key: {
          remoteJid,
          fromMe: false,
          id: mediaId,
        },
        message: {
          imageMessage: {
            url: "https://example.com/fake-evidence.jpg",
            mimetype: "image/jpeg",
            caption: "Front elevation acrylic board installed",
          },
        },
        pushName: testName,
      },
    };

    const uploadResult = await whatsappEvolution.handleWebhook(uploadPayload);
    console.log("    Upload result action:", uploadResult.action);
    assert(uploadResult.status === "processed" && uploadResult.action === "media_saved", "Photo upload processed and linked to project");

    // Verify executionDocuments and botUploadInbox records
    const senderDigits = testPhoneE164.replace(/\D/g, "");
    const [inboxItem] = await db
      .select()
      .from(botUploadInbox)
      .where(eq(botUploadInbox.senderId, senderDigits))
      .orderBy(sql`${botUploadInbox.id} DESC`)
      .limit(1);

    assert(!!inboxItem, "Bot upload inbox item created");
    assert(inboxItem.source === "whatsapp", "Inbox item tagged with source 'whatsapp'");
    assert(inboxItem.uploadType === "photo", "Inbox item correctly categorized as 'photo'");
    assert(inboxItem.mappedEstimateId === testEstimate.id, "Mapped to correct estimate ID");

    // Verify executionDocuments
    const [execDoc] = await db
      .select()
      .from(executionDocuments)
      .where(eq(executionDocuments.uploadedBy, installer.id))
      .orderBy(sql`${executionDocuments.id} DESC`)
      .limit(1);

    assert(!!execDoc, "Execution document created in project workspace");
    assert(execDoc.estimateId === testEstimate.id, "Execution doc linked to assigned estimate");
    assert(execDoc.documentType === "photo", "Execution doc typed as 'photo'");

    // TEST 8: Webhook Retried Event Deduplication
    console.log("\n--- PART B5: Idempotent Webhook Deduplication ---");
    const duplicateWebhookResult = await whatsappEvolution.handleWebhook(uploadPayload);
    assert(duplicateWebhookResult.status === "duplicate_ignored", "Duplicate webhook payload detected and safely ignored");

    // TEST 9: Revoke Assignment
    console.log("\n--- PART A7: Revoke Assignment ---");
    const revoked = await installerService.revokeAssignment(testCompanyId, assignment.linkId);
    assert(revoked === true, "Assignment revoked successfully");

    const waProjectsAfterRevoke = await whatsappEvolution.getAssignedProjects(testPhoneE164, testCompanyId);
    assert(!waProjectsAfterRevoke.some(p => p.estimateId === testEstimate.id), "Project access revoked from WhatsApp immediately");

    // TEST 10: Deactivate Installer
    console.log("\n--- PART A8: Deactivate Installer ---");
    const deactivated = await installerService.deactivateInstaller(testCompanyId, installer.id);
    assert(deactivated === true, "Installer deactivated");

    const [uAfter] = await db.select().from(users).where(eq(users.id, installer.id)).limit(1);
    assert(uAfter.isActive === false, "User record marked inactive");

  } catch (err: any) {
    console.error("Test execution failed with error:", err);
    failed++;
  } finally {
    console.log("\n=================================================");
    console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log("=================================================");
    await pool.end();
    process.exit(failed > 0 ? 1 : 0);
  }
}

runInstallerWorkflowTests();
