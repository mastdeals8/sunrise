import { db, pool } from "../server/db";
import { whatsappEvolution } from "../server/services/whatsappEvolution";
import { botSettings, botUploadInbox, webhookLogs, clients, stores } from "../shared/schema";
import { eq, sql } from "drizzle-orm";

async function runRegressionTests() {
  console.log("=================================================");
  console.log("SUNRISE MEDIA ERP - WHATSAPP EVOLUTION REGRESSION TESTS");
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

  try {
    // 1. Service Config Resolution Test
    console.log("Test 1: Service Configuration & Instance Name Resolution");
    const configCo1 = await whatsappEvolution.getConfig(1);
    const configCo2 = await whatsappEvolution.getConfig(2);
    const configCo3 = await whatsappEvolution.getConfig(3);

    assert(configCo1.instanceName.includes("company_1") || configCo1.instanceName === "sunrise_media", "Company 1 instance name resolved");
    assert(configCo2.instanceName.includes("company_2"), "Company 2 instance name isolated");
    assert(configCo3.instanceName.includes("company_3"), "Company 3 instance name isolated");

    // 2. Multi-company data creation for CRM matching test
    console.log("\nTest 2: CRM Auto-Matching on Inbound WhatsApp Webhook");
    const testPhone = "9823633833";
    const testSenderJid = `${testPhone}@s.whatsapp.net`;
    const testMsgId = `TEST_MSG_${Date.now()}`;

    // Create a temporary client with this mobile if none exists
    const [testClient] = await db
      .insert(clients)
      .values({
        companyId: 1,
        name: "Test WhatsApp AutoMatch Client",
        mobile: "+91 98236 33833",
        city: "Pune",
      })
      .returning();

    // Simulate inbound messages.upsert webhook from Evolution API
    const webhookPayload = {
      event: "messages.upsert",
      instance: "sunrise_company_1",
      data: {
        key: {
          remoteJid: testSenderJid,
          fromMe: false,
          id: testMsgId,
        },
        pushName: "Kunal Test",
        message: {
          conversation: "Sending store photos and signed challan for approval.",
        },
        messageType: "conversation",
        messageTimestamp: Math.floor(Date.now() / 1000),
      },
    };

    const webhookResult = await whatsappEvolution.handleWebhook(webhookPayload);
    assert(webhookResult.status === "processed", "Inbound webhook processed successfully");

    // Verify record in botUploadInbox
    const [inboxRow] = await db
      .select()
      .from(botUploadInbox)
      .where(sql`${botUploadInbox.rawPayload}->'data'->'key'->>'id' = ${testMsgId}`)
      .limit(1);

    assert(!!inboxRow, "Inbound message inserted into botUploadInbox");
    assert(inboxRow?.source === "whatsapp", "Source correctly recorded as 'whatsapp'");
    assert(inboxRow?.senderId === testPhone, "Sender phone extracted correctly without JID suffix");
    assert(inboxRow?.mappedClientId === testClient.id, "Sender phone auto-matched to client ID");
    assert(inboxRow?.status === "mapped", "Status set to 'mapped' due to confident phone match");
    assert(inboxRow?.remarks?.includes("Auto-matched to client"), "Remarks explain matching reasoning");

    // 3. Duplicate Prevention Test
    console.log("\nTest 3: Webhook Duplicate Prevention");
    const duplicateResult = await whatsappEvolution.handleWebhook(webhookPayload);
    assert(duplicateResult.status === "duplicate_skipped", "Duplicate webhook message ID was detected and skipped");

    const duplicateCount = await db
      .select()
      .from(botUploadInbox)
      .where(sql`${botUploadInbox.rawPayload}->'data'->'key'->>'id' = ${testMsgId}`);
    assert(duplicateCount.length === 1, "Exactly 1 record exists in inbox (no duplicates)");

    // 4. Self-Message Filtering Test
    console.log("\nTest 4: Self-Message (fromMe) Filtering");
    const selfMsgPayload = {
      event: "messages.upsert",
      instance: "sunrise_company_1",
      data: {
        key: {
          remoteJid: testSenderJid,
          fromMe: true,
          id: `SELF_MSG_${Date.now()}`,
        },
        pushName: "Self",
        message: { conversation: "Message from phone itself" },
      },
    };
    const selfResult = await whatsappEvolution.handleWebhook(selfMsgPayload);
    assert(selfResult.status === "ignored_from_me", "Self messages sent from phone ignored to prevent echo loops");

    // 5. Connection Update & QR Code Update Events
    console.log("\nTest 5: Connection State & QR Code Webhook Handling");
    const connPayload = {
      event: "connection.update",
      instance: "sunrise_company_1",
      data: { state: "open" },
    };
    const connResult = await whatsappEvolution.handleWebhook(connPayload);
    assert(connResult.status === "processed", "connection.update processed");

    const [updatedSettings] = await db.select().from(botSettings).where(eq(botSettings.platform, "whatsapp"));
    assert(updatedSettings?.enabled === true, "botSettings marked enabled when state is 'open'");
    assert((updatedSettings?.settings as any)?.connectionStatus === "open", "connectionStatus recorded in settings JSON");

    // 6. Clean up test records
    console.log("\nCleaning up test artifacts...");
    await db.delete(botUploadInbox).where(eq(botUploadInbox.senderId, testPhone));
    await db.delete(webhookLogs).where(eq(webhookLogs.platform, "whatsapp"));
    await db.delete(clients).where(eq(clients.id, testClient.id));
    console.log("Cleanup complete.");

  } catch (err: any) {
    console.error("Test execution threw error:", err);
    failed++;
  } finally {
    console.log("\n=================================================");
    console.log(`RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log("=================================================");
    await pool.end();
    process.exit(failed > 0 ? 1 : 0);
  }
}

runRegressionTests();
