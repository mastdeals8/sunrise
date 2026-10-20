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
 * Generates official Tally XML envelope for an invoice matching standard Tally ERP 9 / Prime XML import structure.
 */
export function buildTallyInvoiceXml(
  invoice: any,
  options: {
    settings?: Partial<TallySettings>;
    company?: any;
    client?: any;
  }
): string {
  const settings = options.settings || {};
  const company = options.company || {};
  const client = options.client || {};

  const companyName = settings.companyName || company.name || company.legalName || "Sunrise Media";
  const salesLedger = settings.salesLedger || "Sales";
  const cgstLedger = settings.cgstLedger || "CGST";
  const sgstLedger = settings.sgstLedger || "SGST";
  const igstLedger = settings.igstLedger || "IGST";
  const voucherType = settings.voucherType || "Sales";

  const partyName = invoice.partyName || client.name || "Unknown Party";

  const companyStateCode = company.stateCode
    ? String(company.stateCode).padStart(2, "0")
    : company.gstin
    ? company.gstin.slice(0, 2)
    : "27";
  const clientStateCode = client.stateCode
    ? String(client.stateCode).padStart(2, "0")
    : client.gstNumber
    ? client.gstNumber.slice(0, 2)
    : companyStateCode;

  const isInterstate = Boolean(clientStateCode && clientStateCode !== companyStateCode);

  const invoiceDate = invoice.date
    ? new Date(invoice.date).toISOString().split("T")[0].replace(/-/g, "")
    : "";
  const amount = Number(invoice.totalAmount || 0);
  const taxable = Number(invoice.amount || (amount - Number(invoice.taxAmount || 0)));
  const totalTax = Number(invoice.taxAmount || 0);

  let cgst = 0;
  let sgst = 0;
  let igst = 0;

  if (isInterstate) {
    igst = totalTax;
  } else {
    cgst = Number((totalTax / 2).toFixed(2));
    sgst = Number((totalTax - cgst).toFixed(2));
  }

  const narration = `${invoice.invoiceNumber} — ${partyName}`;

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
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
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
          </VOUCHER>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
}

/**
 * Triggers a client-side download of the Tally XML file.
 */
export function downloadTallyXml(xml: string, invoiceNumber: string): void {
  const blob = new Blob([xml], { type: "application/xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `tally_${invoiceNumber.replace(/[^a-zA-Z0-9_-]/g, "_")}.xml`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
