import { config } from "dotenv";
config();

import { getExecutionDocumentSignedUrl } from "../client/src/lib/api";

async function run() {
  console.log("=== RUNNING DOCUMENT LINK RESOLUTION REGRESSION TESTS ===");

  // 1. Direct URLs pass through
  const httpsUrl = "https://example.com/files/invoice.pdf";
  const resolvedHttps = await getExecutionDocumentSignedUrl(httpsUrl, false);
  if (resolvedHttps !== httpsUrl) {
    throw new Error(`Expected direct HTTPS URL to pass through, got ${resolvedHttps}`);
  }
  console.log("✓ Direct HTTPS URL passed through unchanged");

  // 2. Direct data URLs pass through
  const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  const resolvedData = await getExecutionDocumentSignedUrl(dataUrl, false);
  if (resolvedData !== dataUrl) {
    throw new Error(`Expected data URL to pass through, got ${resolvedData}`);
  }
  console.log("✓ Data URL passed through unchanged");

  // 3. Storage path resolution with real document generates signed URL with token
  const realStoragePath = "estimate-32/po/1789708520834-Purchase_Order_6010032890.PDF";
  const signedPreview = await getExecutionDocumentSignedUrl(realStoragePath, false, 32);
  console.log("Signed preview URL generated:", signedPreview.split("?")[0], "(token hidden)");
  if (!signedPreview.startsWith("http")) {
    throw new Error(`Expected signed URL to start with http/https, got: ${signedPreview}`);
  }
  if (signedPreview.includes("download=")) {
    throw new Error(`Preview URL should not contain download parameter`);
  }
  console.log("✓ Preview signed URL correctly formatted without download param");

  const signedDownload = await getExecutionDocumentSignedUrl(realStoragePath, true, 32);
  if (!signedDownload.includes("download=")) {
    throw new Error(`Download URL must contain download parameter`);
  }
  console.log("✓ Download signed URL correctly formatted with download param");

  // 4. Test missing or nonexistent file rejection
  try {
    await getExecutionDocumentSignedUrl("estimate-999/nonexistent/file.pdf", false);
    throw new Error("Should have thrown error for nonexistent document");
  } catch (err: any) {
    if (err.message.includes("Document not found")) {
      console.log("✓ Nonexistent document correctly caught and structured error returned");
    } else {
      throw err;
    }
  }

  // 5. Test empty or missing storage path rejection
  try {
    await getExecutionDocumentSignedUrl("", false);
    throw new Error("Should fail on empty storage value");
  } catch (err: any) {
    if (err.message.includes("No storage path")) {
      console.log("✓ Correctly rejected empty storage path");
    } else {
      throw err;
    }
  }

  console.log("=== ALL DOCUMENT LINK TESTS PASSED ===");
}

run().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
