import { supabase, isBoltMode } from "./supabase";

export interface TallySettings {
  enabled: boolean;
  mode?: string;       // "xml" | "push" | "both"
  tallyUrl: string;
  companyName: string;
  salesLedger: string;
  cgstLedger: string;
  sgstLedger: string;
  igstLedger: string;
  roundOffLedger?: string;
  voucherType: string;
}

export const DEFAULT_TALLY_SETTINGS: TallySettings = {
  enabled: false,
  mode: "xml",
  tallyUrl: "http://localhost:9000",
  companyName: "",
  salesLedger: "Sales",
  cgstLedger: "CGST",
  sgstLedger: "SGST",
  igstLedger: "IGST",
  roundOffLedger: "Round Off",
  voucherType: "Sales",
};

/**
 * Escapes special XML characters to prevent malformed XML envelopes.
 */
export function escapeXml(unsafe: string): string {
  if (!unsafe) return "";
  return String(unsafe).replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "&": return "&amp;";
      case "'": return "&apos;";
      case '"': return "&quot;";
      default: return c;
    }
  });
}

/**
 * Fetches Tally settings from Supabase app_settings (in Bolt mode) or Express backend.
 */
export async function fetchTallySettings(token: string | null): Promise<TallySettings> {
  if (isBoltMode) {
    try {
      const { data, error } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "tally_settings")
        .maybeSingle();
      if (!error && data?.value) {
        const parsed = typeof data.value === "string" ? JSON.parse(data.value) : data.value;
        return { ...DEFAULT_TALLY_SETTINGS, ...parsed };
      }
    } catch (err) {
      console.warn("[tally] Error reading tally_settings from supabase:", err);
    }
    return DEFAULT_TALLY_SETTINGS;
  }

  try {
    const res = await fetch("/api/tally/settings", {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (res.ok) {
      const data = await res.json();
      return { ...DEFAULT_TALLY_SETTINGS, ...data };
    }
  } catch (err) {
    console.warn("[tally] Error reading tally_settings from api:", err);
  }
  return DEFAULT_TALLY_SETTINGS;
}

/**
 * Saves Tally settings to Supabase app_settings (in Bolt mode) or Express backend.
 */
export async function saveTallySettings(token: string | null, settings: TallySettings): Promise<boolean> {
  if (isBoltMode) {
    try {
      const { error } = await supabase
        .from("app_settings")
        .upsert(
          {
            key: "tally_settings",
            value: settings,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "key" }
        );
      return !error;
    } catch (err) {
      console.warn("[tally] Error saving tally_settings to supabase:", err);
      return false;
    }
  }

  try {
    const res = await fetch("/api/tally/settings", {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(settings),
    });
    return res.ok;
  } catch (err) {
    console.warn("[tally] Error saving tally_settings to api:", err);
    return false;
  }
}

/**
 * Checks whether an invoice can be exported to Tally according to accounting rules.
 * Drafts and cancelled invoices are strictly rejected with an explicit explanation.
 */
export interface InvoiceEligibility {
  eligible: boolean;
  reason?: string;
}

export function checkInvoiceTallyEligibility(invoice: any): InvoiceEligibility {
  if (!invoice) {
    return { eligible: false, reason: "Invoice data is missing" };
  }
  const status = (invoice.status || "").toLowerCase().trim();
  if (status === "draft") {
    return {
      eligible: false,
      reason: `Only submitted or approved invoices can be exported to Tally. Current status: draft`,
    };
  }
  if (status === "cancelled") {
    return {
      eligible: false,
      reason: `Invoice ${invoice.invoiceNumber || ""} is cancelled and cannot be exported.`,
    };
  }
  if (status === "hold") {
    return {
      eligible: false,
      reason: `Invoice ${invoice.invoiceNumber || ""} is on hold. Only finalized invoices can be exported.`,
    };
  }

  const eligibleStatuses = ["submitted", "approved", "paid", "partially_paid", "unpaid", "partial", "overdue"];
  if (status && !eligibleStatuses.includes(status)) {
    return {
      eligible: false,
      reason: `Only submitted or approved invoices can be exported to Tally. Current status: ${invoice.status}`,
    };
  }

  if (!invoice.invoiceNumber || !String(invoice.invoiceNumber).trim()) {
    return {
      eligible: false,
      reason: "Invoice number is missing.",
    };
  }

  const amount = Number(invoice.totalAmount || 0);
  if (isNaN(amount) || amount <= 0) {
    return {
      eligible: false,
      reason: `Invoice ${invoice.invoiceNumber} has an invalid or zero total amount (₹${invoice.totalAmount || 0}).`,
    };
  }

  return { eligible: true };
}

/**
 * Builds the <TALLYMESSAGE> voucher XML element for a single sales invoice.
 */
export function buildTallyVoucherMessage(
  invoice: any,
  options: {
    settings?: Partial<TallySettings>;
    company?: any;
    client?: any;
  }
): string {
  const eligibility = checkInvoiceTallyEligibility(invoice);
  if (!eligibility.eligible) {
    throw new Error(eligibility.reason || `Invoice ${invoice?.invoiceNumber} is not eligible for Tally export.`);
  }

  const settings = options.settings || {};
  const company = options.company || {};
  const client = options.client || {};

  const salesLedger = settings.salesLedger !== undefined ? settings.salesLedger : "Sales";
  const cgstLedger = settings.cgstLedger !== undefined ? settings.cgstLedger : "CGST";
  const sgstLedger = settings.sgstLedger !== undefined ? settings.sgstLedger : "SGST";
  const igstLedger = settings.igstLedger !== undefined ? settings.igstLedger : "IGST";
  const roundOffLedger = settings.roundOffLedger !== undefined ? settings.roundOffLedger : "Round Off";
  const voucherType = settings.voucherType || "Sales";

  if (!salesLedger || !salesLedger.trim()) throw new Error("Missing required Tally mapping: Sales Ledger is not configured.");

  const partyName = (invoice.partyName && invoice.partyName !== "Customer")
    ? invoice.partyName
    : client.name || invoice.partyName || "Unknown Party";

  const companyStateCode = company.stateCode || company.state_code
    ? String(company.stateCode || company.state_code).padStart(2, "0")
    : company.gstin
    ? String(company.gstin).slice(0, 2)
    : "27";
  const clientStateCode = client.stateCode || client.state_code
    ? String(client.stateCode || client.state_code).padStart(2, "0")
    : client.gstNumber || client.gst_number
    ? String(client.gstNumber || client.gst_number).slice(0, 2)
    : companyStateCode;

  const isInterstate = Boolean(clientStateCode && clientStateCode !== companyStateCode);

  const invoiceDate = invoice.date
    ? new Date(invoice.date).toISOString().split("T")[0].replace(/-/g, "")
    : new Date().toISOString().split("T")[0].replace(/-/g, "");
  const amount = Number(invoice.totalAmount || 0);
  const taxable = Number(invoice.amount !== undefined ? invoice.amount : (amount - Number(invoice.taxAmount || 0)));
  const totalTax = Number(invoice.taxAmount || 0);

  let cgst = 0;
  let sgst = 0;
  let igst = 0;

  if (isInterstate) {
    igst = totalTax;
    if (igst > 0 && !igstLedger.trim()) {
      throw new Error("Missing required Tally mapping: IGST Ledger is not configured.");
    }
  } else {
    cgst = Number((totalTax / 2).toFixed(2));
    sgst = Number((totalTax - cgst).toFixed(2));
    if (cgst > 0 && !cgstLedger.trim()) {
      throw new Error("Missing required Tally mapping: CGST Ledger is not configured.");
    }
    if (sgst > 0 && !sgstLedger.trim()) {
      throw new Error("Missing required Tally mapping: SGST Ledger is not configured.");
    }
  }

  // Calculate round-off difference to ensure exact zero-balance accounting in Tally
  const expectedTotal = Number((taxable + (isInterstate ? igst : (cgst + sgst))).toFixed(2));
  const roundOff = Number((amount - expectedTotal).toFixed(2));

  const narration = `${invoice.invoiceNumber} — ${partyName}`;

  return `        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <VOUCHER REMOTEID="${escapeXml(invoice.invoiceNumber)}" VCHTYPE="${escapeXml(voucherType)}" ACTION="Create">
            <DATE>${invoiceDate}</DATE>
            <NARRATION>${escapeXml(narration)}</NARRATION>
            <VOUCHERTYPENAME>${escapeXml(voucherType)}</VOUCHERTYPENAME>
            <VOUCHERNUMBER>${escapeXml(invoice.invoiceNumber)}</VOUCHERNUMBER>
            <PARTYLEDGERNAME>${escapeXml(partyName)}</PARTYLEDGERNAME>
            <GUID>${escapeXml(invoice.invoiceNumber)}</GUID>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>${escapeXml(partyName)}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
              <AMOUNT>-${amount.toFixed(2)}</AMOUNT>
              <BILLALLOCATIONS.LIST>
                <NAME>${escapeXml(invoice.invoiceNumber)}</NAME>
                <BILLTYPE>New Ref</BILLTYPE>
                <AMOUNT>-${amount.toFixed(2)}</AMOUNT>
              </BILLALLOCATIONS.LIST>
            </ALLLEDGERENTRIES.LIST>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>${escapeXml(salesLedger)}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <AMOUNT>${taxable.toFixed(2)}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>
            ${cgst > 0 ? `<ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>${escapeXml(cgstLedger)}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <AMOUNT>${cgst.toFixed(2)}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>` : ""}
            ${sgst > 0 ? `<ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>${escapeXml(sgstLedger)}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <AMOUNT>${sgst.toFixed(2)}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>` : ""}
            ${igst > 0 ? `<ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>${escapeXml(igstLedger)}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <AMOUNT>${igst.toFixed(2)}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>` : ""}
            ${Math.abs(roundOff) >= 0.01 ? `<ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>${escapeXml(roundOffLedger)}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>${roundOff > 0 ? "No" : "Yes"}</ISDEEMEDPOSITIVE>
              <AMOUNT>${roundOff > 0 ? roundOff.toFixed(2) : `-${Math.abs(roundOff).toFixed(2)}`}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>` : ""}
          </VOUCHER>
        </TALLYMESSAGE>`;
}

/**
 * Generates official Tally XML envelope for a single invoice matching standard Tally ERP 9 / Prime XML import structure.
 */
export function buildTallyInvoiceXml(
  invoice: any,
  options: {
    settings?: Partial<TallySettings>;
    company?: any;
    client?: any;
  }
): string {
  const company = options.company || {};
  const settings = options.settings || {};
  const companyName = settings.companyName || company.name || company.legalName || "Sunrise Media";

  const voucherXml = buildTallyVoucherMessage(invoice, options);

  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
${voucherXml}
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
}

export interface TallyBatchExportResult {
  xml: string;
  filename: string;
  exportedInvoices: any[];
  ineligibleInvoices: { invoice: any; reason: string }[];
}

/**
 * Generates official Tally XML envelope containing multiple vouchers in a single import file.
 * Returns exported invoices and explicit reasons for any ineligible invoices.
 */
export function buildTallyBatchXml(
  invoices: any[],
  options: {
    settings?: Partial<TallySettings>;
    company?: any;
    clients?: any[];
  }
): TallyBatchExportResult {
  const settings = options.settings || {};
  const company = options.company || {};
  const clients = options.clients || [];
  const companyName = settings.companyName || company.name || company.legalName || "Sunrise Media";

  const exportedInvoices: any[] = [];
  const ineligibleInvoices: { invoice: any; reason: string }[] = [];
  const voucherMessages: string[] = [];

  for (const inv of invoices) {
    const eligibility = checkInvoiceTallyEligibility(inv);
    if (!eligibility.eligible) {
      ineligibleInvoices.push({ invoice: inv, reason: eligibility.reason || "Ineligible status" });
      continue;
    }

    try {
      const client = clients.find((c: any) => c.id === (inv.clientId || inv.client_id)) || null;
      const voucherXml = buildTallyVoucherMessage(inv, { settings, company, client });
      voucherMessages.push(voucherXml);
      exportedInvoices.push(inv);
    } catch (err: any) {
      ineligibleInvoices.push({ invoice: inv, reason: err.message || "Failed to generate voucher XML" });
    }
  }

  if (exportedInvoices.length === 0) {
    const reasons = ineligibleInvoices.map(i => `• ${i.invoice?.invoiceNumber || "Invoice"}: ${i.reason}`).join("\n");
    throw new Error(`No eligible invoices to export.\n\n${reasons}`);
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
${voucherMessages.join("\n")}
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;

  let filename: string;
  if (exportedInvoices.length === 1) {
    filename = `Tally_SalesVoucher_${String(exportedInvoices[0].invoiceNumber).replace(/[^a-zA-Z0-9_-]/g, "_")}.xml`;
  } else {
    const dateStr = new Date().toISOString().split("T")[0];
    filename = `Tally_SalesVouchers_Batch_${exportedInvoices.length}_${dateStr}.xml`;
  }

  return { xml, filename, exportedInvoices, ineligibleInvoices };
}

/**
 * Triggers a client-side download of the Tally XML file.
 */
export function downloadTallyXml(xml: string, filenameOrInvoiceNumber: string): void {
  const blob = new Blob([xml], { type: "application/xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const safeFilename = filenameOrInvoiceNumber.toLowerCase().endsWith(".xml")
    ? filenameOrInvoiceNumber
    : `Tally_SalesVoucher_${filenameOrInvoiceNumber.replace(/[^a-zA-Z0-9_-]/g, "_")}.xml`;
  a.download = safeFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
