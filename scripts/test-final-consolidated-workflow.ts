import { db } from "../server/db";
import { sql, eq, and, isNull } from "drizzle-orm";
import {
  users,
  companyUsers,
  companies,
  estimates,
  clients,
  brands,
  stores,
  executionStores,
  fieldAccessLinks,
  executionDocuments,
  deliveryChallans,
  botUploadInbox,
} from "../shared/schema";
import { handleTelegramWebhook, getUserSession, setUserSession, clearUserSession } from "../server/telegram";
import { whatsappEvolution, getWhatsAppSession, clearWhatsAppSession } from "../server/services/whatsappEvolution";
import { installerService } from "../server/services/installerService";
import path from "path";
import fs from "fs";

async function runConsolidatedTests() {
  console.log("===============================================================================");
  console.log("SUNRISE MEDIA ERP - FINAL CONSOLIDATED REGRESSION TEST SUITE");
  console.log("===============================================================================\n");

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

  process.env.TELEGRAM_MOCK = "1";
  process.env.WHATSAPP_MOCK = "1";

  const uploadsDir = path.resolve(process.cwd(), "uploads");
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  try {
    // -------------------------------------------------------------
    // PART A: DATABASE CONTACT REGISTRATION & USERS TABLE PERMISSION
    // -------------------------------------------------------------
    console.log("--- PART A: CONTACT REGISTRATION & 'permission denied for table users' FIX ---");

    const testPhone = "+919876500001";
    const testPhoneClean = "9876500001";

    // Clean up any leftovers
    await db.execute(sql`DELETE FROM company_users WHERE user_id IN (SELECT id FROM users WHERE phone = ${testPhone} OR whatsapp_phone = ${testPhone})`);
    await db.execute(sql`DELETE FROM users WHERE phone = ${testPhone} OR whatsapp_phone = ${testPhone}`);

    // Test 1: admin_upsert_installer RPC execution (verifying the DB permission fix)
    const payload = {
      company_id: 1,
      name: "Ramesh Sharma",
      phone: "9876500001",
      whatsapp_phone: "9876500001",
      role: "installer",
      notes: "Pune South Installer",
    };

    const rpcRes: any = await db.execute(sql`
      SELECT admin_upsert_installer(${JSON.stringify(payload)}::jsonb) as res;
    `);

    const rpcData = rpcRes.rows?.[0]?.res;
    assert(rpcData?.success === true, "admin_upsert_installer RPC succeeded without permission denial");
    assert(rpcData?.user?.phone === testPhone, `Phone normalized to E.164: ${rpcData?.user?.phone}`);

    const registeredUserId = rpcData?.user?.id;

    // Verify companyUsers link exists for company 1
    const [coUser] = await db
      .select()
      .from(companyUsers)
      .where(and(eq(companyUsers.userId, registeredUserId), eq(companyUsers.companyId, 1)));
    assert(!!coUser, "Installer properly linked to Company 1 (Sunrise Media Pune) in company_users");

    // Test 2: Duplicate phone registration in same company is rejected
    let dupFailed = false;
    try {
      await db.execute(sql`
        SELECT admin_upsert_installer(${JSON.stringify(payload)}::jsonb) as res;
      `);
    } catch (err: any) {
      dupFailed = true;
    }
    assert(dupFailed, "Duplicate contact with same phone in company 1 is prevented");

    // Test 3: Same phone in different company (Company 2: Delhi Company) is isolated & allowed
    const payloadCo2 = {
      company_id: 2,
      name: "Ramesh Delhi Branch",
      phone: "9876500001",
      whatsapp_phone: "9876500001",
      role: "installer",
      notes: "Delhi company installer",
    };
    const rpcCo2: any = await db.execute(sql`
      SELECT admin_upsert_installer(${JSON.stringify(payloadCo2)}::jsonb) as res;
    `);
    assert(rpcCo2.rows?.[0]?.res?.success === true, "Same phone can be registered in Company 2 without cross-company collision");

    // Clean up Co2 record
    await db.execute(sql`DELETE FROM company_users WHERE user_id = ${rpcCo2.rows?.[0]?.res?.user?.id}`);
    await db.execute(sql`DELETE FROM users WHERE id = ${rpcCo2.rows?.[0]?.res?.user?.id}`);

    // -------------------------------------------------------------
    // PART B: ADMIN PROJECT ASSIGNMENT & STORE LABELS
    // -------------------------------------------------------------
    console.log("\n--- PART B: ADMIN PROJECT ASSIGNMENT & STORE LABELS ---");

    // Setup 2 ongoing test estimates for Company 1
    const [client1] = await db
      .insert(clients)
      .values({ companyId: 1, name: `ABF Client ${Date.now()}`, city: "Pune" })
      .returning();

    const [brand1] = await db
      .insert(brands)
      .values({ companyId: 1, name: `ABF Brand ${Date.now()}`, parentClientId: client1.id })
      .returning();

    const [store1] = await db
      .insert(stores)
      .values({ companyId: 1, clientId: client1.id, brandId: brand1.id, name: "Aditya Birla, Pune", storeCode: "ABP-01" })
      .returning();

    const [est1] = await db
      .insert(estimates)
      .values({
        companyId: 1,
        clientId: client1.id,
        storeId: store1.id,
        estimateNumber: `SM/E/26-27/${Date.now().toString().slice(-4)}A`,
        title: "Festive Store Installation",
        subject: "Festive Store Installation",
        status: "approved",
      })
      .returning();

    // Multi-store estimate
    const [est2] = await db
      .insert(estimates)
      .values({
        companyId: 1,
        clientId: client1.id,
        estimateNumber: `SM/E/26-27/${Date.now().toString().slice(-4)}B`,
        title: "Multi-Store Brand Rollout",
        subject: "West Zone Retail Rollout",
        status: "approved",
      })
      .returning();

    await db.insert(executionStores).values([
      { estimateId: est2.id, storeCode: "MS-01", storeName: "Store Alpha Pune" },
      { estimateId: est2.id, storeCode: "MS-02", storeName: "Store Beta Mumbai" },
      { estimateId: est2.id, storeCode: "MS-03", storeName: "Store Gamma Nashik" },
    ]);

    // Test listEligibleProjects
    const eligibleProjects = await installerService.listEligibleProjects(1);
    const p1 = eligibleProjects.find((p) => p.id === est1.id);
    const p2 = eligibleProjects.find((p) => p.id === est2.id);

    assert(!!p1, "Single-store estimate listed in eligible ongoing projects");
    assert(p1?.storeCount === 1, `Single-store storeCount is 1 (got ${p1?.storeCount})`);
    assert(p1?.label.includes("1 store"), `Single-store label formatted correctly: ${p1?.label}`);

    assert(!!p2, "Multi-store estimate listed in eligible ongoing projects");
    assert(p2?.storeCount === 3, `Multi-store storeCount is 3 (got ${p2?.storeCount})`);
    assert(p2?.label.includes("3 stores"), `Multi-store label formatted correctly: ${p2?.label}`);

    // Test Search filter
    const searchMatch = await installerService.listEligibleProjects(1, "West Zone");
    assert(searchMatch.some((p) => p.id === est2.id), "Search by subject 'West Zone' finds project");

    // Test Batch Assignment
    const batchAssignRes = await installerService.batchAssignProjectsToInstaller(1, {
      installerId: registeredUserId,
      estimateIds: [est1.id, est2.id],
    });

    assert(batchAssignRes.successful.length === 2, `Batch assigned 2 projects successfully (got ${batchAssignRes.successful.length})`);
    assert(batchAssignRes.failed.length === 0, "No failures on initial valid batch assignment");

    // Test Duplicate Assignment Prevention: Re-assigning same projects should return existing active link
    const reassignRes = await installerService.batchAssignProjectsToInstaller(1, {
      installerId: registeredUserId,
      estimateIds: [est1.id],
    });
    assert(reassignRes.successful.length === 1, "Duplicate assignment safely returns existing active link without duplicating fieldAccessLinks");

    const linksCount = await db
      .select()
      .from(fieldAccessLinks)
      .where(and(eq(fieldAccessLinks.estimateId, est1.id), sql`${fieldAccessLinks.metadata}->>'userId' = ${String(registeredUserId)}`));
    assert(linksCount.length === 1, "Exactly 1 fieldAccessLink exists for project + installer");

    // -------------------------------------------------------------
    // PART C: UNIFIED WHATSAPP BOT WORKFLOW
    // -------------------------------------------------------------
    console.log("\n--- PART C: UNIFIED WHATSAPP BOT WORKFLOW ---");

    // Set user whatsapp verified
    await db.update(users).set({
      whatsappVerified: true,
      whatsappChatId: `${testPhoneClean}@s.whatsapp.net`,
      isActive: true,
    }).where(eq(users.id, registeredUserId));

    clearWhatsAppSession(testPhoneClean);

    // Test WA 1: Greeting triggers 4-option menu
    const waGreetingRes = await whatsappEvolution.handleWebhook({
      event: "messages.upsert",
      instance: "sunrise_company_1",
      data: {
        key: { id: `WA_MSG_${Date.now()}_1`, remoteJid: `${testPhoneClean}@s.whatsapp.net`, fromMe: false },
        pushName: "Ramesh Sharma",
        message: { conversation: "hi" },
      },
    });
    assert(waGreetingRes.action === "menu_presented", "WhatsApp 'hi' responds with 4-choice menu");
    assert(getWhatsAppSession(testPhoneClean).state === "MENU", "WhatsApp session transitioned to MENU");

    // Test WA 2: Option 1 (Select a project) lists assigned projects
    const waOpt1Res = await whatsappEvolution.handleWebhook({
      event: "messages.upsert",
      instance: "sunrise_company_1",
      data: {
        key: { id: `WA_MSG_${Date.now()}_2`, remoteJid: `${testPhoneClean}@s.whatsapp.net`, fromMe: false },
        pushName: "Ramesh Sharma",
        message: { conversation: "1" },
      },
    });
    assert(waOpt1Res.action === "projects_listed", "WhatsApp replying '1' lists assigned projects");
    assert(getWhatsAppSession(testPhoneClean).state === "AWAITING_PROJECT_SELECTION", "WhatsApp session transitioned to AWAITING_PROJECT_SELECTION");

    // Test WA 3: Select Project 1 -> prompts for the 3 categories
    const waPickProjRes = await whatsappEvolution.handleWebhook({
      event: "messages.upsert",
      instance: "sunrise_company_1",
      data: {
        key: { id: `WA_MSG_${Date.now()}_3`, remoteJid: `${testPhoneClean}@s.whatsapp.net`, fromMe: false },
        pushName: "Ramesh Sharma",
        message: { conversation: "1" },
      },
    });
    assert(waPickProjRes.action === "project_selected", "WhatsApp selecting project prompts for the 3 upload categories");

    // Test WA 4: Pick Category 1 (Installation Photo)
    const waPickCatRes = await whatsappEvolution.handleWebhook({
      event: "messages.upsert",
      instance: "sunrise_company_1",
      data: {
        key: { id: `WA_MSG_${Date.now()}_4`, remoteJid: `${testPhoneClean}@s.whatsapp.net`, fromMe: false },
        pushName: "Ramesh Sharma",
        message: { conversation: "1" },
      },
    });
    assert(waPickCatRes.action === "category_selected", "WhatsApp category 1 selected (Installation Photo)");

    // Test WA 5: Upload Installation Photo
    const test5MsgId = `WA_MSG_${Date.now()}_5`;
    const waPhotoRes = await whatsappEvolution.handleWebhook({
      event: "messages.upsert",
      instance: "sunrise_company_1",
      data: {
        key: { id: test5MsgId, remoteJid: `${testPhoneClean}@s.whatsapp.net`, fromMe: false },
        pushName: "Ramesh Sharma",
        message: { imageMessage: { caption: "INSTALLATION" } },
      },
    });
    assert(waPhotoRes.action === "media_saved", "WhatsApp photo with caption 'INSTALLATION' uploaded & linked");

    // Verify executionDocuments
    const [waDoc1] = await db
      .select()
      .from(executionDocuments)
      .where(and(eq(executionDocuments.estimateId, est1.id), eq(executionDocuments.documentType, "photo")))
      .limit(1);
    assert(!!waDoc1, "Execution document for Installation Photo created in DB");

    // Test WA 6: Upload Delivery Challan with caption DC
    const waDcRes = await whatsappEvolution.handleWebhook({
      event: "messages.upsert",
      instance: "sunrise_company_1",
      data: {
        key: { id: `WA_MSG_${Date.now()}_6`, remoteJid: `${testPhoneClean}@s.whatsapp.net`, fromMe: false },
        pushName: "Ramesh Sharma",
        message: { imageMessage: { caption: "DC" } },
      },
    });
    assert(waDcRes.action === "media_saved", "WhatsApp document with caption 'DC' mapped to signed_dc category");

    // Verify executionDocuments has signed_dc
    const [waDocDc] = await db
      .select()
      .from(executionDocuments)
      .where(and(eq(executionDocuments.estimateId, est1.id), eq(executionDocuments.documentType, "signed_dc")))
      .limit(1);
    assert(!!waDocDc, "Execution document for Delivery Challan (signed_dc) created in DB");

    // Test WA 7: Upload Transportation Photo with caption TRANSPORTATION
    const waTransportRes = await whatsappEvolution.handleWebhook({
      event: "messages.upsert",
      instance: "sunrise_company_1",
      data: {
        key: { id: `WA_MSG_${Date.now()}_7`, remoteJid: `${testPhoneClean}@s.whatsapp.net`, fromMe: false },
        pushName: "Ramesh Sharma",
        message: { imageMessage: { caption: "TRANSPORTATION" } },
      },
    });
    assert(waTransportRes.action === "media_saved", "WhatsApp photo with caption 'TRANSPORTATION' mapped to transport_receipt category");

    const [waDocTransport] = await db
      .select()
      .from(executionDocuments)
      .where(and(eq(executionDocuments.estimateId, est1.id), eq(executionDocuments.documentType, "transport_receipt")))
      .limit(1);
    assert(!!waDocTransport, "Execution document for Transportation Photo (transport_receipt) created in DB");

    // Test WA 8: Unknown caption rejection
    const waBadCaptionRes = await whatsappEvolution.handleWebhook({
      event: "messages.upsert",
      instance: "sunrise_company_1",
      data: {
        key: { id: `WA_MSG_${Date.now()}_8`, remoteJid: `${testPhoneClean}@s.whatsapp.net`, fromMe: false },
        pushName: "Ramesh Sharma",
        message: { imageMessage: { caption: "RANDOM_UNKNOWN_CAPTION_123" } },
      },
    });
    assert(waBadCaptionRes.action === "upload_rejected_ambiguous_caption", "WhatsApp rejects unknown caption and asks user to choose category");

    // Test WA 9: Duplicate webhook delivery is skipped idempotently
    const waDupRes = await whatsappEvolution.handleWebhook({
      event: "messages.upsert",
      instance: "sunrise_company_1",
      data: {
        key: { id: test5MsgId, remoteJid: `${testPhoneClean}@s.whatsapp.net`, fromMe: false },
        pushName: "Ramesh Sharma",
        message: { imageMessage: { caption: "INSTALLATION" } },
      },
    });
    assert(waDupRes.status === "duplicate_ignored", "WhatsApp duplicate webhook delivery skipped idempotently");

    // -------------------------------------------------------------
    // PART D: UNIFIED TELEGRAM BOT WORKFLOW
    // -------------------------------------------------------------
    console.log("\n--- PART D: UNIFIED TELEGRAM BOT WORKFLOW ---");

    const tgChatId = "9988771122";
    await db.update(users).set({
      telegramChatId: tgChatId,
      telegramVerified: true,
      isActive: true,
    }).where(eq(users.id, registeredUserId));

    clearUserSession(tgChatId);

    // Test TG 1: Greeting (/start or hi) presents 4-option menu
    const tgGreeting = await handleTelegramWebhook({
      update_id: 10001,
      message: {
        message_id: 1,
        chat: { id: tgChatId, first_name: "Ramesh" },
        from: { id: tgChatId, first_name: "Ramesh" },
        text: "/start",
        date: Math.floor(Date.now() / 1000),
      },
    }, uploadsDir);
    assert(tgGreeting.action === "welcome_menu_displayed" || tgGreeting.action === "menu_presented", "Telegram /start replies with welcome menu");

    // Test TG 2: Choose 'Select a project' via numbered reply '1'
    const tgOpt1 = await handleTelegramWebhook({
      update_id: 10002,
      message: {
        message_id: 2,
        chat: { id: tgChatId },
        from: { id: tgChatId },
        text: "1",
        date: Math.floor(Date.now() / 1000),
      },
    }, uploadsDir);
    assert(tgOpt1.action === "projects_listed" || tgOpt1.action === "menu_projects_listed", "Telegram reply '1' presents project list");

    // Test TG 3: Select project via callback query 'proj:<id>'
    const tgSelectProj = await handleTelegramWebhook({
      update_id: 10003,
      callback_query: {
        id: "cb_1",
        from: { id: tgChatId },
        data: `proj:${est1.id}`,
      },
    }, uploadsDir);
    assert(tgSelectProj.action === "project_selected" || tgSelectProj.action === "project_selected_prompt_categories", "Telegram callback selects project and prompts for the 3 categories");

    // Test TG 4: Upload photo with caption DC
    const tgDcUpload = await handleTelegramWebhook({
      update_id: 10004,
      message: {
        message_id: 4,
        chat: { id: tgChatId },
        from: { id: tgChatId },
        photo: [{ file_id: "mock_tg_dc_file", width: 100, height: 100 }],
        caption: "DC",
        date: Math.floor(Date.now() / 1000),
      },
    }, uploadsDir);
    assert(tgDcUpload.action === "upload_saved", "Telegram upload with caption 'DC' saved to signed_dc category");

    // Test TG 5: Upload photo with caption TRANSPORT
    const tgTransportUpload = await handleTelegramWebhook({
      update_id: 10005,
      message: {
        message_id: 5,
        chat: { id: tgChatId },
        from: { id: tgChatId },
        photo: [{ file_id: "mock_tg_transport_file", width: 100, height: 100 }],
        caption: "TRANSPORT",
        date: Math.floor(Date.now() / 1000),
      },
    }, uploadsDir);
    assert(tgTransportUpload.action === "upload_saved", "Telegram upload with caption 'TRANSPORT' saved to transport_receipt category");

    // Test TG 6: Unknown caption in Telegram prompts category selection
    const tgUnknownUpload = await handleTelegramWebhook({
      update_id: 10006,
      message: {
        message_id: 6,
        chat: { id: tgChatId },
        from: { id: tgChatId },
        photo: [{ file_id: "mock_tg_unk_file", width: 100, height: 100 }],
        caption: "RANDOM_TG_CAPTION",
        date: Math.floor(Date.now() / 1000),
      },
    }, uploadsDir);
    assert(tgUnknownUpload.action === "upload_rejected_unknown_caption" || tgUnknownUpload.action === "upload_rejected_ambiguous_caption", "Telegram rejects unknown caption and presents inline category selector");

    // Test TG 7: Duplicate update_id ignored
    const tgDup = await handleTelegramWebhook({
      update_id: 10001,
      message: {
        message_id: 1,
        chat: { id: tgChatId },
        from: { id: tgChatId },
        text: "/start",
        date: Math.floor(Date.now() / 1000),
      },
    }, uploadsDir);
    assert(tgDup.action === "duplicate_ignored", "Telegram duplicate update_id skipped idempotently");

    // Clean up created test entities
    await db.execute(sql`DELETE FROM execution_documents WHERE estimate_id IN (${est1.id}, ${est2.id})`);
    await db.execute(sql`DELETE FROM bot_upload_inbox WHERE mapped_estimate_id IN (${est1.id}, ${est2.id})`);
    await db.execute(sql`DELETE FROM field_access_links WHERE estimate_id IN (${est1.id}, ${est2.id})`);
    await db.execute(sql`DELETE FROM execution_stores WHERE estimate_id IN (${est1.id}, ${est2.id})`);
    await db.execute(sql`DELETE FROM estimates WHERE id IN (${est1.id}, ${est2.id})`);
    await db.execute(sql`DELETE FROM stores WHERE id = ${store1.id}`);
    await db.execute(sql`DELETE FROM brands WHERE id = ${brand1.id}`);
    await db.execute(sql`DELETE FROM clients WHERE id = ${client1.id}`);
    await db.execute(sql`DELETE FROM company_users WHERE user_id = ${registeredUserId}`);
    await db.execute(sql`DELETE FROM users WHERE id = ${registeredUserId}`);

    console.log("\n===============================================================================");
    console.log(`CONSOLIDATED REGRESSION RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log("===============================================================================\n");

    if (failed > 0) process.exit(1);
    process.exit(0);
  } catch (err: any) {
    console.error("Test Suite Execution Failed:", err);
    process.exit(1);
  }
}

runConsolidatedTests();
