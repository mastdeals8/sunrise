// InvoiceDocument is the single React renderer for invoice preview,
// browser print/PDF export, and the invoice page inside Invoice Packet.
// It is the canonical Sunrise Media Tax Invoice for preview, print/PDF, and
// invoice packets. Saved invoice values remain the commercial source of truth.

import React, { useEffect, useMemo, useState } from "react";
import { companyAssetUrl } from "../utils/companyAssets";
import { orderedStoreKeysFromGrouping } from "../pages/operations/utils/estimateOrdering";

export interface InvoiceDocumentProps {
  invoice: any;
  estimate?: any;
  client?: any;
  sellerProfile?: any;
  assetToken?: string | null;
  products?: any[];
  stores?: any[];
}

const amountInWords = (num: number): string => {
  if (!num) return "Zero Only";
  const a = ["", "One ", "Two ", "Three ", "Four ", "Five ", "Six ", "Seven ", "Eight ", "Nine ", "Ten ", "Eleven ", "Twelve ", "Thirteen ", "Fourteen ", "Fifteen ", "Sixteen ", "Seventeen ", "Eighteen ", "Nineteen "];
  const b = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const padded = ("000000000" + Math.floor(num)).slice(-9);
  const match = padded.match(/^(\d{2})(\d{2})(\d{2})(\d{1})(\d{2})$/);
  if (!match) return "";
  const words = (value: string) => a[Number(value)] || `${b[Number(value[0])]} ${a[Number(value[1])]}`;
  let result = "";
  if (Number(match[1])) result += `${words(match[1])}Crore `;
  if (Number(match[2])) result += `${words(match[2])}Lakh `;
  if (Number(match[3])) result += `${words(match[3])}Thousand `;
  if (Number(match[4])) result += `${a[Number(match[4])]}Hundred `;
  if (Number(match[5])) result += `${result ? "and " : ""}${words(match[5])}`;
  return `${result.trim()} Only`;
};

// Convert an image URL to a base64 data URL for reliable html2canvas capture.
// Supabase public bucket URLs support CORS, so fetch succeeds and the data URL
// renders without cross-origin canvas tainting.
const useDataUrl = (url: string): { dataUrl: string; ready: boolean } => {
  const [dataUrl, setDataUrl] = useState("");
  const [ready, setReady] = useState(!url);

  useEffect(() => {
    if (!url) { setReady(true); return; }
    let cancelled = false;
    setReady(false);
    fetch(url, { mode: "cors" })
      .then(res => { if (!res.ok) throw new Error("fetch failed"); return res.blob(); })
      .then(blob => {
        if (cancelled) return;
        const reader = new FileReader();
        reader.onloadend = () => {
          if (cancelled) return;
          const result = reader.result as string;
          if (result) setDataUrl(result);
          setReady(true);
        };
        reader.onerror = () => { if (!cancelled) setReady(true); };
        reader.readAsDataURL(blob);
      })
      .catch(() => { if (!cancelled) setReady(true); });
    return () => { cancelled = true; };
  }, [url]);

  return { dataUrl: dataUrl || url, ready };
};

const InvoiceLogo: React.FC<{ src: string; companyName: string; maxWidth?: number }> = ({ src, companyName, maxWidth = 230 }) => {
  const [failed, setFailed] = useState(!src);
  return failed
    ? <div style={{ fontWeight: 900, fontSize: "22px", lineHeight: 1.1, textAlign: "right" }}>{companyName}</div>
    : <img src={src} alt={companyName} onError={() => setFailed(true)} style={{ width: maxWidth, maxWidth: "100%", height: "auto", objectFit: "contain" }} />;
};

const num = (n: number) => (Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const PlaceholderNames = new Set(["all", "alll", "item", "", "-", "n/a", "na"]);
const resolveItemName = (row: any, products: any[]): string => {
  const saved = String(row.itemName ?? row.item_name ?? row.productName ?? row.product_name ?? "").trim();
  if (saved && !PlaceholderNames.has(saved.toLowerCase())) return saved;
  const productId = Number(row.productId ?? row.product_id ?? 0);
  if (productId) {
    const product = products.find((p: any) => Number(p.id) === productId);
    if (product?.name) return product.name;
  }
  return saved || "Item";
};

interface StoreGroup {
  storeCode: string;
  storeName: string;
  items: any[];
}

const InvoiceDocument: React.FC<InvoiceDocumentProps> = ({
  invoice: inv,
  estimate: est,
  client,
  sellerProfile = {},
  assetToken: token,
  products = [],
  stores = [],
}) => {
  const lines = Array.isArray(inv.lineItems || inv.line_items) ? (inv.lineItems || inv.line_items) : [];
  const subtotal = Number(inv.amount ?? lines.reduce((sum: number, row: any) => sum + Number(row.amount ?? row.totalPrice ?? Number(row.quantity || 0) * Number(row.rate || 0)), 0));
  const totalTax = Number(inv.taxAmount ?? Math.max(0, Number(inv.totalAmount || 0) - subtotal));
  const componentTax = lines.reduce((totals: { cgst: number; sgst: number; igst: number }, row: any) => ({
    cgst: totals.cgst + Number(row.cgstAmount ?? row.cgst_amount ?? 0),
    sgst: totals.sgst + Number(row.sgstAmount ?? row.sgst_amount ?? 0),
    igst: totals.igst + Number(row.igstAmount ?? row.igst_amount ?? 0),
  }), { cgst: 0, sgst: 0, igst: 0 });
  const hasComponentTax = componentTax.cgst !== 0 || componentTax.sgst !== 0 || componentTax.igst !== 0;
  const isIgst = hasComponentTax ? componentTax.igst > 0 : Boolean(est?.gstType === "IGST" || (est?.igstAmount && Number(est.igstAmount) > 0));
  const componentTotal = componentTax.cgst + componentTax.sgst + componentTax.igst;
  const useSavedComponents = hasComponentTax && Math.abs(componentTotal - totalTax) < 0.01;
  const igst = useSavedComponents ? componentTax.igst : (isIgst ? totalTax : 0);
  const cgst = useSavedComponents ? componentTax.cgst : (isIgst ? 0 : totalTax / 2);
  const sgst = useSavedComponents ? componentTax.sgst : (isIgst ? 0 : totalTax - cgst);
  const grandTotal = Number(inv.totalAmount || subtotal + cgst + sgst + igst);

  const companyName = sellerProfile?.name || sellerProfile?.companyName || "Sunrise Media";
  const companyAddress = sellerProfile?.address || "";
  const companyEmail = sellerProfile?.email || "";
  const companyMobile = sellerProfile?.mobile || "";
  const sellerGstin = sellerProfile?.gstin || "27ABZFS5736R1ZR";

  // Convert logo and signature to base64 data URLs for reliable PDF capture
  const logoUrl = companyAssetUrl(sellerProfile?.logoPath, token);
  const { dataUrl: logoDataUrl, ready: logoReady } = useDataUrl(logoUrl);
  const sigUrl = companyAssetUrl(sellerProfile?.signatureStampPath, token);
  const { dataUrl: sigDataUrl, ready: sigReady } = useDataUrl(sigUrl);

  // Signal image readiness for Playwright-based PDF rendering
  useEffect(() => {
    if (logoReady && sigReady) {
      document.documentElement.setAttribute("data-invoice-images-ready", "true");
    }
  }, [logoReady, sigReady]);

  const billingName = est?.billingLegalNameSnapshot || inv.partyName || client?.name || "";
  const billingAddress = est?.billingAddressSnapshot || client?.address || "";
  const billingGstin = est?.billingGstinSnapshot || est?.gstin || client?.gstin || client?.gstNumber || "";
  const billingStateCode = est?.billingStateCodeSnapshot || "";
  const billingPan = est?.pan || client?.pan || "";
  const poNumber = inv.poNumber || est?.poNumber || "";
  const poDateValue = inv.poDate || inv.po_date || est?.poDate || est?.po_date || "";

  const dateStr = inv.date
    ? new Date(inv.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).replace(/ /g, "-")
    : "";
  const poDateStr = poDateValue
    ? new Date(poDateValue).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).replace(/ /g, "-")
    : "";

  const termsLines = String(sellerProfile?.terms || "1. Taxes will be applicable.\n2. 100% Payment after the delivery of the meterial.\n3. Transportation charges As per Actual.\n4. Any additional work / rework will be extra.")
    .split(/\n+/)
    .map((line: string) => line.trim())
    .filter(Boolean);

  // Store grouping — resolves store for each invoice line item by:
  // 1. Using the line item's own storeCode if present
  // 2. Falling back to the estimate's storeGrouping, which maps store IDs to
  //    item SL numbers — this is how multi-store estimates track which items
  //    belong to which store. The invoice line items carry the same SL numbers.
  // Does not invent store information — uses existing saved metadata only.
  const storeGroups = useMemo<StoreGroup[]>(() => {
    const storeByCode = new Map<string, any>();
    (stores || []).forEach((s: any) => {
      const code = String(s.storeCode || s.code || "").trim();
      if (code) storeByCode.set(code, s);
    });

    // Build SL → storeCode mapping from the estimate's storeGrouping
    const estimateGrouping = (est?.storeGrouping || {}) as Record<string, any>;
    const orderedSids = orderedStoreKeysFromGrouping(estimateGrouping);
    const slToStoreCode = new Map<number, string>();
    const sidToStoreCode = new Map<string, string>();
    orderedSids.forEach(sid => {
      const s = (stores || []).find((st: any) => st.id === Number(sid));
      const code = String(s?.storeCode || s?.code || "").trim();
      if (code) {
        sidToStoreCode.set(sid, code);
        const groupData = estimateGrouping[sid];
        const itemSls: number[] = Array.isArray(groupData) ? groupData : (groupData?.itemSls || []);
        itemSls.forEach((sl: any) => {
          const parsed = Number(sl);
          if (Number.isFinite(parsed)) slToStoreCode.set(parsed, code);
        });
      }
    });

    // Ordered store codes from the estimate's storeGrouping
    const orderedStoreCodes = orderedSids.map(sid => sidToStoreCode.get(sid)).filter(Boolean) as string[];

    // Group line items by storeCode
    const groups: StoreGroup[] = [];
    const seenCodes: string[] = [];

    const ensureGroup = (code: string) => {
      if (seenCodes.includes(code)) return;
      seenCodes.push(code);
      const store = storeByCode.get(code);
      groups.push({
        storeCode: code,
        storeName: store?.name || code || "Store",
        items: [],
      });
    };

    // First pass: create groups in estimate order
    orderedStoreCodes.forEach(code => ensureGroup(code));

    // Second pass: add items to groups. Resolve storeCode from line item or
    // from the estimate's storeGrouping via SL number matching.
    lines.forEach((line: any) => {
      let code = String(line.storeCode ?? line.store_code ?? "").trim();
      if (!code) {
        const sl = Number(line.sl ?? 0);
        if (sl > 0 && slToStoreCode.has(sl)) {
          code = slToStoreCode.get(sl)!;
        }
      }
      ensureGroup(code);
      const group = groups.find(g => g.storeCode === code);
      if (group) group.items.push(line);
    });

    // Remove empty groups (no items)
    return groups.filter(g => g.items.length > 0);
  }, [lines, stores, est]);

  const hasStoreHeadings = storeGroups.length > 1 || (storeGroups.length === 1 && storeGroups[0].storeCode !== "" && storeGroups[0].storeCode !== "default");

  // Inline styles — same paradigm as EstimateDocument, so they survive
  // print without depending on Tailwind classes.
  const cellBase: React.CSSProperties = { border: "1px solid #000", padding: "3px 5px", fontSize: "10px", lineHeight: 1.3, verticalAlign: "middle", pageBreakInside: "avoid" };
  const cellLeft: React.CSSProperties = { ...cellBase, textAlign: "left" };
  const cellRight: React.CSSProperties = { ...cellBase, textAlign: "right" };
  const cellCenter: React.CSSProperties = { ...cellBase, textAlign: "center" };
  const headCell: React.CSSProperties = { ...cellBase, fontWeight: 700, textAlign: "center", backgroundColor: "#fff" };

  const COL_COUNT = 8;
  const columnWidths = ["4%", "23%", "27%", "10%", "7%", "8%", "10%", "11%"];

  const storeHeadingStyle: React.CSSProperties = {
    ...cellBase,
    fontWeight: 700,
    backgroundColor: "#e2e8f0",
    padding: "4px 8px",
    fontSize: "10px",
  };

  const metaLabelCell: React.CSSProperties = {
    padding: "1px 8px 1px 0",
    textAlign: "left",
    whiteSpace: "nowrap",
    width: "92px",
    verticalAlign: "top",
  };
  const metaValueCell: React.CSSProperties = {
    textAlign: "left",
    width: "170px",
    maxWidth: "170px",
    overflowWrap: "anywhere",
    wordBreak: "break-word",
    lineHeight: 1.25,
    verticalAlign: "top",
  };
  const metaRow = (label: string, value: React.ReactNode, bold = false) => (
    <tr>
      <td style={metaLabelCell}>{label}</td>
      <td style={{ ...metaValueCell, fontWeight: bold ? 700 : undefined }}>{value}</td>
    </tr>
  );

  let srNo = 0;

  return (
    <div
      className="invoice-print"
      data-source="invoice-print"
      data-print-document="true"
      style={{ background: "#fff", color: "#000", fontFamily: "Arial, Helvetica, sans-serif" }}
    >
      {/* Tax Invoice header. No Ship To block: Sunrise invoices bill the client directly. */}
      <table className="invoice-document-header" style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
        <tbody>
          <tr>
            <td colSpan={2} style={{ border: "1px solid #000", padding: "7px 10px", textAlign: "center", fontSize: "15px", fontWeight: 800, letterSpacing: "0.6px" }}>
              TAX INVOICE
            </td>
          </tr>
          <tr style={{ verticalAlign: "top" }}>
            <td style={{ border: "1px solid #000", padding: "8px 10px", fontSize: "10px", lineHeight: 1.4, width: "57%" }}>
              <div style={{ fontWeight: 800, marginBottom: "3px" }}>Bill To</div>
              <div style={{ fontWeight: 700 }}>M/S : {billingName}</div>
              {billingAddress && <div style={{ whiteSpace: "pre-wrap" }}>{billingAddress}</div>}
              {billingStateCode && <div>State Code: {billingStateCode}</div>}
              {billingGstin && <div style={{ fontWeight: 700 }}>GSTIN : {billingGstin}</div>}
              {billingPan && <div style={{ fontWeight: 700 }}>PAN : {billingPan}</div>}
            </td>
            <td style={{ border: "1px solid #000", padding: "8px 10px", width: "43%", textAlign: "right", fontSize: "10px", verticalAlign: "top" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
                <div style={{ textAlign: "left", fontWeight: 800, whiteSpace: "nowrap" }}>GST/UIN : {sellerGstin}</div>
                <InvoiceLogo src={logoDataUrl} companyName={companyName} maxWidth={155} />
              </div>
              <table style={{ marginTop: "12px", marginLeft: "auto", borderCollapse: "collapse", tableLayout: "fixed", width: "100%" }}>
                <tbody>
                  {metaRow("Invoice / Bill No. :", inv.invoiceNumber, true)}
                  {metaRow("Bill Date :", dateStr)}
                  {poNumber && metaRow("PO No. :", poNumber)}
                  {poDateStr && metaRow("PO Date :", poDateStr)}
                  {(est?.subject || est?.title) && metaRow("Job :", est?.subject || est?.title)}
                </tbody>
              </table>
            </td>
          </tr>
        </tbody>
      </table>

      {/* Invoice table — store-grouped with data-pdf-row markers for row-aware slicing */}
      <table className="invoice-table" style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", marginTop: "4px" }}>
        <colgroup>
          {columnWidths.map((w, i) => <col key={i} style={{ width: w }} />)}
        </colgroup>
        <thead data-pdf-thead style={{ display: "table-header-group" }}>
          <tr>
            <td style={headCell}>Sr.</td>
            <td style={headCell}>Item</td>
            <td style={headCell}>Description</td>
            <td style={headCell}>HSN / SAC</td>
            <td style={headCell}>GST %</td>
            <td style={headCell}>Quantity</td>
            <td style={headCell}>Rate</td>
            <td style={headCell}>Amount</td>
          </tr>
        </thead>
        <tbody>
          {storeGroups.map((group) => (
            <React.Fragment key={group.storeCode || "default"}>
              {hasStoreHeadings && (
                <tr data-pdf-row data-pdf-store-heading="true">
                  <td colSpan={COL_COUNT} style={storeHeadingStyle}>
                    Store: {group.storeName}{group.storeCode && ` \u2014 Store Code: ${group.storeCode}`}
                  </td>
                </tr>
              )}
              {group.items.map((row: any, index: number) => {
                srNo++;
                const qty = Number(row.quantity || 0);
                const rate = Number(row.rate || 0);
                const amount = Number(row.amount ?? row.totalPrice ?? qty * rate);
                const description = String(row.description ?? "").trim();
                const taxPercent = Number(row.taxPercent ?? row.gstPercent ?? row.gst_percent ?? 0);
                return (
                  <tr key={row.id || `${group.storeCode}-${index}`} data-pdf-row style={{ pageBreakInside: "avoid" }}>
                    <td style={cellCenter}>{srNo}</td>
                    <td style={{ ...cellLeft, fontWeight: 600 }}>{resolveItemName(row, products)}</td>
                    <td style={{ ...cellLeft, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{description}</td>
                    <td style={cellCenter}>{row.hsn || ""}</td>
                    <td style={cellCenter}>{taxPercent > 0 ? `${taxPercent}%` : ""}</td>
                    <td style={cellCenter}>{qty}</td>
                    <td style={cellRight}>{num(rate)}</td>
                    <td style={{ ...cellRight, fontWeight: 600 }}>{num(amount)}</td>
                  </tr>
                );
              })}
            </React.Fragment>
          ))}
        </tbody>
        {/* Totals — wrapped in a data-pdf-row tbody so they stay together */}
        <tbody data-pdf-row>
          <tr style={{ backgroundColor: "#fff066" }}>
            <td colSpan={7} style={{ ...cellBase, fontWeight: 700, textAlign: "right", paddingRight: "10px" }}>TOTAL AMOUNT BEFORE TAX</td>
            <td style={{ ...cellRight, fontWeight: 700 }}>{num(subtotal)}</td>
          </tr>
          {isIgst ? (
            <tr>
              <td colSpan={7} style={{ ...cellBase, fontWeight: 700, textAlign: "right", paddingRight: "10px" }}>Add : IGST</td>
              <td style={{ ...cellRight, fontWeight: 700 }}>{num(igst)}</td>
            </tr>
          ) : (
            <>
              <tr>
                <td colSpan={7} style={{ ...cellBase, fontWeight: 700, textAlign: "right", paddingRight: "10px" }}>Add : CGST</td>
                <td style={{ ...cellRight, fontWeight: 700 }}>{num(cgst)}</td>
              </tr>
              <tr>
                <td colSpan={7} style={{ ...cellBase, fontWeight: 700, textAlign: "right", paddingRight: "10px" }}>Add : SGST</td>
                <td style={{ ...cellRight, fontWeight: 700 }}>{num(sgst)}</td>
              </tr>
            </>
          )}
          <tr>
            <td colSpan={7} style={{ ...cellBase, fontWeight: 700, textAlign: "right", paddingRight: "10px" }}>GRAND TOTAL</td>
            <td style={{ ...cellRight, fontWeight: 700 }}>{num(grandTotal)}</td>
          </tr>
        </tbody>
      </table>

      {/* Amount in words */}
      <div data-pdf-row style={{ marginTop: "6px", fontSize: "10px", fontWeight: 700, pageBreakInside: "avoid" }}>
        Rupees : {amountInWords(grandTotal)}
      </div>

      {/* Footer — marked as a single data-pdf-row so it stays together */}
      <div className="invoice-footer-block" data-pdf-row style={{ marginTop: "8px", pageBreakInside: "avoid" }}>
        <table className="invoice-document-footer" style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            <tr style={{ verticalAlign: "top" }}>
              <td style={{ ...cellBase, padding: "8px 10px", width: "38%" }}>
                <div style={{ color: "#b91c1c", fontWeight: 700, textDecoration: "underline", marginBottom: "4px" }}>Terms &amp; Condition :</div>
                {termsLines.map((line: string, idx: number) => <div key={idx}>{line}</div>)}
              </td>
              <td style={{ ...cellBase, padding: "8px 10px", width: "34%" }}>
                <div style={{ fontWeight: 700, marginBottom: "4px" }}>BANK ACCOUNT DETAILS</div>
                <div>Bank Name : {sellerProfile?.bankName || ""}</div>
                <div>Branch Name : {sellerProfile?.bankBranch || ""}</div>
                <div>C.A/c No : {sellerProfile?.bankAccountNumber || ""}</div>
                <div>IFSC NO : {sellerProfile?.bankIfsc || ""}</div>
              </td>
              <td style={{ ...cellBase, padding: "8px 10px", width: "28%", textAlign: "right", verticalAlign: "bottom" }}>
                <div style={{ fontWeight: 700 }}>For {companyName.toUpperCase()}</div>
                <div style={{ height: "52px", display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
                  {sigDataUrl && (
                    <img
                      src={sigDataUrl}
                      alt="Signature and stamp"
                      style={{ maxHeight: "48px", maxWidth: "150px", objectFit: "contain" }}
                    />
                  )}
                </div>
                <div style={{ fontWeight: 700 }}>Authorised Signatory</div>
              </td>
            </tr>
          </tbody>
        </table>
        <div style={{ backgroundColor: "#f59e0b", color: "#fff", textAlign: "center", padding: "6px 8px", letterSpacing: "0.3px" }}>
          <div style={{ fontSize: "16px", fontWeight: 900, letterSpacing: "1.5px", lineHeight: 1.1 }}>{companyName.toUpperCase()}</div>
          {companyAddress && <div style={{ fontSize: "9px", marginTop: "3px", lineHeight: 1.25 }}>{companyAddress}</div>}
          {(companyMobile || companyEmail) && <div style={{ fontSize: "9px", marginTop: "1px", lineHeight: 1.25 }}>{[companyMobile, companyEmail].filter(Boolean).join("  \u00b7  ")}</div>}
        </div>
      </div>
    </div>
  );
};

export default InvoiceDocument;
