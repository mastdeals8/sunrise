import assert from "assert";
import dotenv from "dotenv";
dotenv.config();

// Ensure mock mode is active for safe test execution
process.env.WHATSAPP_MOCK = "1";

import { db } from "../server/db";
import { estimates, estimateItems, clients, stores, companies } from "../shared/schema";
import { eq, sql } from "drizzle-orm";
import { renderEstimatePdfBuffer } from "../server/utils/estimatePdfRenderer";
import { whatsappEvolution, normalizeWhatsAppNumber } from "../server/services/whatsappEvolution";
import { getEstimatePdfFilename } from "../client/src/pages/operations/utils/estimatePdfExport";

async function runWhatsAppEstimateAttachmentTests() {
  console.log("===============================================================================");
  console.log("SUNRISE MEDIA ERP — WHATSAPP ESTIMATE PDF ATTACHMENT TEST SUITE");
  console.log("===============================================================================\n");

  let passed = 0;
  let failed = 0;

  function testAssert(cond: boolean, desc: string) {
    if (cond) {
      console.log(`  ✅ PASS: ${desc}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${desc}`);
      failed++;
    }
  }

  try {
    // -------------------------------------------------------------------------
    // PART 1: Phone Normalization & Validation
    // -------------------------------------------------------------------------
    console.log("--- PART 1: Recipient Phone Normalization & Validation ---");
    testAssert(normalizeWhatsAppNumber("9823633833") === "919823633833", "10-digit Indian number normalized with 91 prefix");
    testAssert(normalizeWhatsAppNumber("09823633833") === "919823633833", "11-digit number with leading 0 normalized without leading 0");
    testAssert(normalizeWhatsAppNumber("+91 98236 33833") === "919823633833", "Pre-formatted +91 number stripped of symbols and spaces");
    testAssert(normalizeWhatsAppNumber("+62 812 3456 7890") === "6281234567890", "International number preserved with country code");
    testAssert(normalizeWhatsAppNumber("12345").length < 10, "Short number detected as invalid (< 10 digits)");

    // -------------------------------------------------------------------------
    // PART 2: Canonical Estimate PDF Generation
    // -------------------------------------------------------------------------
    console.log("\n--- PART 2: Canonical Estimate PDF Generation ---");
    // Pick an existing approved estimate from Company 1
    const [testEst] = await db.select().from(estimates).where(eq(estimates.companyId, 1)).limit(1);
    assert(testEst, "Test estimate must exist in company 1");

    console.log(`  Target Estimate: #${testEst.id} (${testEst.estimateNumber})`);

    const { buffer, filename, estimateNumber } = await renderEstimatePdfBuffer({
      estimateId: testEst.id,
      scale: 100,
      density: "normal",
      layout: "portrait",
    });

    testAssert(Buffer.isBuffer(buffer), "Generated PDF is a valid binary Buffer");
    testAssert(buffer.length > 20000, `PDF size is realistic (${buffer.length} bytes, >20KB)`);
    testAssert(buffer.slice(0, 4).toString() === "%PDF", "PDF starts with valid %PDF header magic bytes");
    testAssert(filename.endsWith(".pdf"), `Filename ends with .pdf extension: "${filename}"`);
    testAssert(filename.includes(testEst.estimateNumber.replace(/[\/\\:*?"<>|]+/g, "-")), "Filename incorporates sanitized estimate number");

    // -------------------------------------------------------------------------
    // PART 3: Filename Canonical Mapping (Single-store vs Multi-store)
    // -------------------------------------------------------------------------
    console.log("\n--- PART 3: Filename Canonical Mapping ---");
    const singleStoreEst = {
      estimateNumber: "SM/E/26-27/500",
      storeName: "Kharadi Flagship",
    };
    const singleStoreFilename = getEstimatePdfFilename(singleStoreEst);
    testAssert(singleStoreFilename === "SM-E-26-27-500_Kharadi_Flagship.pdf" || singleStoreFilename === "SM-E-26-27-500_Kharadi-Flagship.pdf", `Single store filename: ${singleStoreFilename}`);

    const multiStoreEst = {
      estimateNumber: "SM/E/26-27/501",
      storeGrouping: { "1": { storeName: "Store A" }, "2": { storeName: "Store B" } },
    };
    const multiStoreFilename = getEstimatePdfFilename(multiStoreEst);
    testAssert(multiStoreFilename === "SM-E-26-27-501_Multi-Store.pdf", `Multi-store filename: ${multiStoreFilename}`);

    // -------------------------------------------------------------------------
    // PART 4: Evolution API sendMediaMessage with PDF payload
    // -------------------------------------------------------------------------
    console.log("\n--- PART 4: Evolution API Media Dispatch & Base64 Payload ---");
    const base64DataUri = `data:application/pdf;base64,${buffer.toString("base64")}`;
    const testRecipient = "+919823633833";
    const testMessageText = "Dear Client, Please find attached Estimate SM/E/26-27/500.\nWarm regards,\nSunrise Media";

    const mediaSendRes = await whatsappEvolution.sendMediaMessage(
      testRecipient,
      base64DataUri,
      testMessageText,
      filename,
      "document",
      { companyId: 1 }
    );

    testAssert(mediaSendRes.success === true, "sendMediaMessage succeeded with base64 PDF data URI");
    testAssert(typeof mediaSendRes.messageId === "string" && mediaSendRes.messageId.length > 0, `Provider returned messageId: ${mediaSendRes.messageId}`);

    // Invalid phone rejection
    const invalidSendRes = await whatsappEvolution.sendMediaMessage(
      "123", // invalid
      base64DataUri,
      testMessageText,
      filename,
      "document",
      { companyId: 1 }
    );
    testAssert(invalidSendRes.success === false, "sendMediaMessage rejects invalid phone number (< 10 digits)");

    // -------------------------------------------------------------------------
    // PART 5: Strict Non-Fallback Requirement (Requirement 10)
    // -------------------------------------------------------------------------
    console.log("\n--- PART 5: Strict Non-Fallback Verification (Requirement 10) ---");
    // Temporarily disable mock to simulate provider failure
    delete process.env.WHATSAPP_MOCK;
    const failingRes = await whatsappEvolution.sendMediaMessage(
      testRecipient,
      base64DataUri,
      testMessageText,
      filename,
      "document",
      { companyId: 1 } // valid company 1
    );
    testAssert(failingRes.success === false, "Unconnected/unconfigured WhatsApp provider returns failure status without mock");
    testAssert(typeof failingRes.error === "string" && failingRes.error.length > 0, `Provider error reported: "${failingRes.error}"`);
    // Restore mock
    process.env.WHATSAPP_MOCK = "1";

    // -------------------------------------------------------------------------
    // PART 6: Estimate Data & Accounting Integrity (Requirement 13)
    // -------------------------------------------------------------------------
    console.log("\n--- PART 6: Estimate & Accounting Integrity Check ---");
    const [afterEst] = await db.select().from(estimates).where(eq(estimates.id, testEst.id)).limit(1);
    testAssert(afterEst.totalAmount === testEst.totalAmount, "Estimate totalAmount unchanged after PDF generation");
    testAssert(afterEst.estimateNumber === testEst.estimateNumber, "Estimate number unchanged");
    testAssert(afterEst.status === testEst.status, "Estimate status unchanged");

    // -------------------------------------------------------------------------
    // PART 7: Backend Route Logic & Company Isolation
    // -------------------------------------------------------------------------
    console.log("\n--- PART 7: Backend Route Logic & Isolation ---");

    // Test helper to simulate the route logic
    async function simulateSendRoute(reqBody: any, user: any, companyId: number) {
      const { to, text, mediaUrl, mediaBase64, caption, fileName, mediaType, estimateId } = reqBody;
      const normalizedNumber = normalizeWhatsAppNumber(to);
      if (!normalizedNumber || normalizedNumber.length < 10) {
        return { status: 400, body: { success: false, message: "Valid recipient WhatsApp phone number (minimum 10 digits) is required" } };
      }

      let finalMedia = mediaBase64 || mediaUrl;
      let finalFileName = fileName;
      let targetCompanyId = companyId;

      if (estimateId) {
        const [est] = await db.select().from(estimates).where(eq(estimates.id, Number(estimateId))).limit(1);
        if (!est) {
          return { status: 404, body: { success: false, message: `Estimate #${estimateId} not found` } };
        }
        if (companyId && est.companyId && est.companyId !== companyId && user?.role !== "super_admin") {
          return { status: 403, body: { success: false, message: "Access denied: Estimate belongs to a different company workspace" } };
        }
        targetCompanyId = est.companyId || companyId;
        if (!finalMedia) {
          const rendered = await renderEstimatePdfBuffer({
            estimateId: est.id,
            scale: 100,
            density: "normal",
            layout: "portrait",
          });
          finalMedia = `data:application/pdf;base64,${rendered.buffer.toString("base64")}`;
          if (!finalFileName) finalFileName = rendered.filename;
        }
      }

      if (finalMedia) {
        const docCaption = caption || text || "";
        const docFileName = finalFileName || "document.pdf";
        const result = await whatsappEvolution.sendMediaMessage(
          normalizedNumber,
          finalMedia,
          docCaption,
          docFileName,
          mediaType || "document",
          { companyId: targetCompanyId, userId: user?.id }
        );
        if (!result.success) {
          return { status: 500, body: { success: false, message: `Failed to send PDF attachment via WhatsApp: ${result.error}`, error: result.error } };
        }
        return { status: 200, body: { success: true, messageId: result.messageId, fileName: docFileName } };
      }

      return { status: 400, body: { success: false, message: "Message text is required when no media or estimate is provided" } };
    }

    // 7A: Valid estimateId dispatch
    const validRouteRes = await simulateSendRoute(
      { to: "+919823633833", text: "Please review the attached estimate", estimateId: testEst.id },
      { id: 1, role: "manager" },
      1
    );
    testAssert(validRouteRes.status === 200 && validRouteRes.body.success === true, "Valid estimateId renders PDF and returns success 200");
    testAssert(typeof validRouteRes.body.fileName === "string" && validRouteRes.body.fileName.endsWith(".pdf"), `Response returned fileName: ${validRouteRes.body.fileName}`);

    // 7B: Cross-company access rejection
    const crossCompanyRes = await simulateSendRoute(
      { to: "+919823633833", text: "Attempting cross company estimate send", estimateId: testEst.id },
      { id: 2, role: "manager" },
      2 // Company 2 trying to access Company 1 estimate
    );
    testAssert(crossCompanyRes.status === 403, "Cross-company estimate WhatsApp share rejected with 403 Forbidden");

    // 7C: Invalid recipient number rejection
    const invalidPhoneRouteRes = await simulateSendRoute(
      { to: "123", text: "Hello", estimateId: testEst.id },
      { id: 1, role: "manager" },
      1
    );
    testAssert(invalidPhoneRouteRes.status === 400, "Invalid recipient phone rejected with 400 Bad Request");

    // 7D: Non-existent estimate rejection
    const missingEstRes = await simulateSendRoute(
      { to: "+919823633833", text: "Hello", estimateId: 99999999 },
      { id: 1, role: "manager" },
      1
    );
    testAssert(missingEstRes.status === 404, "Non-existent estimate ID rejected with 404 Not Found");
    console.log("===============================================================================");

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err: any) {
    console.error("Test execution failed:", err);
    process.exit(1);
  }
}

runWhatsAppEstimateAttachmentTests();
