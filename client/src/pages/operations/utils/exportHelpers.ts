import { unzipSync, zipSync } from "fflate";
import { orderedEstimateItems, orderedStoreKeysFromItems } from "./estimateOrdering";

export const downloadBlob = (blob: Blob, fileName: string) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(a.href);
};

const s = (v: any) => (v == null ? "" : String(v));
const n = (v: any) => Number(v) || 0;
const r2 = (v: number) => Math.round((Number(v) || 0) * 100) / 100;

const SERVICE_LINE_TYPES = new Set(["packing", "installation", "transport"]);
const isServiceItem = (item: any) =>
  SERVICE_LINE_TYPES.has(String(item.lineType || "").toLowerCase());

const serviceItemLabel = (item: any) => {
  const lineType = String(item?.lineType || "").toLowerCase();
  const rate = Number(item?.rate) || 0;
  if (lineType === "packing") return rate > 0 ? `Packing Charges (${rate}%)` : "Packing Charges";
  if (lineType === "installation") return rate > 0 ? `Installation Charges (${rate}%)` : "Installation Charges";
  if (lineType === "transport") return "Local Transportation";
  return item?.itemName || "";
};

const serviceItemRateLabel = (item: any) => {
  if (item?.calculationType === "percentage") return `${Number(item?.rate) || 0}%`;
  return "";
};

const wrapAddressForExcel = (value: any): string => {
  const raw = String(value || "");
  if (raw.includes("\n")) {
    return raw.split(/\n+/).map((l: string) => l.trim()).filter(Boolean).join("\n");
  }
  return raw
    .replace(/\s*,\s*/g, "\n")
    .split(/\n+/)
    .map((l: string) => l.trim())
    .filter(Boolean)
    .join("\n");
};

const numberToWords = (num: number): string => {
  const a = ["", "One ", "Two ", "Three ", "Four ", "Five ", "Six ", "Seven ", "Eight ", "Nine ", "Ten ",
    "Eleven ", "Twelve ", "Thirteen ", "Fourteen ", "Fifteen ", "Sixteen ", "Seventeen ", "Eighteen ", "Nineteen "];
  const b = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  let internalNum = Math.floor(num);
  if (internalNum === 0) return "Zero";
  const g = (n: number): string => {
    if (n < 20) return a[n];
    return b[Math.floor(n / 10)] + (n % 10 ? "-" + a[n % 10] : "");
  };
  const h = (n: number): string => {
    if (n === 0) return "";
    if (n < 100) return g(n) + " ";
    return a[Math.floor(n / 100)] + "Hundred " + (n % 100 === 0 ? "" : "and " + g(n % 100) + " ");
  };
  let str = "";
  const cr = Math.floor(internalNum / 10000000); internalNum %= 10000000;
  if (cr) str += h(cr) + "Crore ";
  const lk = Math.floor(internalNum / 100000); internalNum %= 100000;
  if (lk) str += h(lk) + "Lakh ";
  const th = Math.floor(internalNum / 1000); internalNum %= 1000;
  if (th) str += h(th) + "Thousand ";
  if (internalNum) str += h(internalNum);
  return "Rupees " + str.trim() + " Only";
};

const enc = new TextEncoder();
const strToU8 = (str: string) => enc.encode(str);
const u8ToString = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

async function embedLogoInWorkbook(
  xlsxBytes: Uint8Array,
  logoUrl: string,
  anchor: { fromCol: number; toCol: number; fromRow: number; toRow: number },
): Promise<Uint8Array> {
  if (!logoUrl) return xlsxBytes;
  try {
    const resp = await fetch(logoUrl);
    if (!resp.ok) return xlsxBytes;
    const logoBytes = new Uint8Array(await resp.arrayBuffer());

    const zip = unzipSync(xlsxBytes);
    const { fromCol, toCol, fromRow, toRow } = anchor;

    zip["xl/media/company-logo.png"] = logoBytes;

    const drawingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <xdr:twoCellAnchor editAs="oneCell">
    <xdr:from><xdr:col>${fromCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${fromRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
    <xdr:to><xdr:col>${toCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${toRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
    <xdr:pic>
      <xdr:nvPicPr><xdr:cNvPr id="1" name="Company Logo" descr="Company Logo"/><xdr:cNvPicPr/></xdr:nvPicPr>
      <xdr:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>
      <xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>
    </xdr:pic>
    <xdr:clientData/>
  </xdr:twoCellAnchor>
</xdr:wsDr>`;
    zip["xl/drawings/drawing1.xml"] = strToU8(drawingXml);
    zip["xl/drawings/_rels/drawing1.xml.rels"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/company-logo.png"/>
</Relationships>`);

    const relPath = "xl/worksheets/_rels/sheet1.xml.rels";
    const relXml = zip[relPath]
      ? u8ToString(zip[relPath])
      : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
    if (!relXml.includes("drawing1.xml")) {
      zip[relPath] = strToU8(relXml.replace(
        "</Relationships>",
        `<Relationship Id="rIdLogoDrawing" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>`,
      ));
    }

    const sheetPath = "xl/worksheets/sheet1.xml";
    const sheetXml = u8ToString(zip[sheetPath]);
    if (!sheetXml.includes('<drawing r:id="rIdLogoDrawing"')) {
      const withNs = sheetXml.includes("xmlns:r=")
        ? sheetXml
        : sheetXml.replace("<worksheet ", `<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" `);
      zip[sheetPath] = strToU8(withNs.replace("</worksheet>", `<drawing r:id="rIdLogoDrawing"/></worksheet>`));
    }

    const contentPath = "[Content_Types].xml";
    let contentXml = u8ToString(zip[contentPath]);
    if (!contentXml.includes('Extension="png"')) {
      contentXml = contentXml.replace("</Types>", `<Default Extension="png" ContentType="image/png"/></Types>`);
    }
    if (!contentXml.includes("/xl/drawings/drawing1.xml")) {
      contentXml = contentXml.replace(
        "</Types>",
        `<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`,
      );
    }
    zip[contentPath] = strToU8(contentXml);

    return zipSync(zip);
  } catch {
    return xlsxBytes;
  }
}

const COL_COUNT = 14;
const LAST_COL = COL_COUNT - 1;
const blankRow = () => Array(COL_COUNT).fill("");

/** Client-side Excel export matching the PDF estimate layout. */
export async function exportEstimateToExcel(
  estimate: any,
  items: any[],
  clientName?: string,
  sellerProfile?: any,
  stores?: any[],
): Promise<void> {
  const XLSX = (await import("xlsx-js-style")).default;

  const isIgst = estimate.gstType === "IGST";
  const storeGrouping = (estimate.storeGrouping as Record<string, any>) || {};
  const sortedItems = orderedEstimateItems(items);

  const sp = sellerProfile || {};
  const companyName = s(sp.name || "Sunrise Media");
  const logoPath: string = s(sp.logoPath || "");
  const bankName = s(sp.bankName || "");
  const bankBranch = s(sp.bankBranch || "");
  const bankAccount = s(sp.bankAccountNumber || "");
  const bankIfsc = s(sp.bankIfsc || "");
  const sellerGstin = s(sp.gstin || "");
  const sellerPan = s(sp.pan || "");
  const sellerAddress = s(sp.address || "");
  const sellerMobile = s(sp.mobile || "");
  const sellerEmail = s(sp.email || "");
  const termsRaw = s(sp.terms || "1. Taxes will be applicable.\n2. 100% Payment after the delivery of the material.\n3. Transportation charges as per actual.\n4. Any additional work / rework will be extra.");
  const sellerTerms = termsRaw.split(/\n+/).map((l: string) => l.trim()).filter(Boolean);

  // Billing / shipping
  const billingName = s(estimate.billingLegalNameSnapshot || clientName || "");
  const billingAddr = s(estimate.billingAddressSnapshot || "");
  const billingGstin = s(estimate.billingGstinSnapshot || estimate.gstin || "");
  const billingStateCode = s(estimate.billingStateCodeSnapshot || estimate.stateCode || "");

  const shippingRaw = s(estimate.shippingAddressSnapshot || estimate.shippingTo || "");
  const shippingHasOwn = shippingRaw.trim().length > 0;
  let shippingName = billingName;
  let shippingAddr = billingAddr;
  if (shippingHasOwn) {
    const shipLines = shippingRaw.split("\n").map((l: string) => l.trim()).filter(Boolean);
    if (shipLines.length > 0 && /^M\/S\s*:/i.test(shipLines[0])) {
      shippingName = shipLines[0].replace(/^M\/S\s*:?\s*/i, "").trim();
      shippingAddr = shipLines.slice(1).join("\n");
    } else {
      shippingAddr = shippingRaw.split("\n").map((l: string) => l.trim()).filter(Boolean).join("\n");
    }
  }

  const dateStr = (estimate.estimateDate || estimate.createdAt)
    ? new Date(estimate.estimateDate || estimate.createdAt)
        .toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
        .replace(/ /g, "-")
    : "";
  const estNo = s(estimate.estimateNumber ?? estimate.estimate_number ?? estimate.id);

  // ── Styles ──────────────────────────────────────────────────────────────────
  const thin = { style: "thin", color: { rgb: "000000" } };
  const thinBorder = { top: thin, bottom: thin, left: thin, right: thin };

  const S_HEADER  = { font: { bold: true, sz: 9 }, alignment: { horizontal: "center", vertical: "center", wrapText: true }, border: thinBorder };
  const S_CELL    = { font: { sz: 9 }, alignment: { vertical: "top", wrapText: true }, border: thinBorder };
  const S_NUM     = { font: { sz: 9 }, alignment: { horizontal: "right", vertical: "top" }, border: thinBorder };
  const S_YELLOW  = { font: { bold: true, sz: 9 }, fill: { patternType: "solid", fgColor: { rgb: "FFF066" } }, alignment: { vertical: "top" }, border: thinBorder };
  const S_YELLOW_NUM = { font: { bold: true, sz: 9 }, fill: { patternType: "solid", fgColor: { rgb: "FFF066" } }, alignment: { horizontal: "right", vertical: "top" }, border: thinBorder };
  const S_STORE   = { font: { bold: true, sz: 10 }, alignment: { horizontal: "left", vertical: "center" }, border: thinBorder };
  const S_SUBJECT = { font: { bold: true, sz: 11 }, alignment: { horizontal: "center", vertical: "center" }, border: thinBorder };
  const S_LOGO    = { font: { bold: true, sz: 22, color: { rgb: "F59E0B" } }, alignment: { horizontal: "right", vertical: "center" } };
  const S_BILL_LABEL = { font: { bold: true, sz: 10 }, alignment: { vertical: "top", wrapText: true } };
  const S_BILL    = { font: { sz: 10 }, alignment: { vertical: "top", wrapText: true } };
  const S_META_L  = { font: { sz: 10 }, alignment: { horizontal: "left", vertical: "center" } };
  const S_META_V  = { font: { bold: true, sz: 10 }, alignment: { horizontal: "left", vertical: "center" } };
  const S_TOTAL_NUM = { font: { bold: true, sz: 9 }, alignment: { horizontal: "right" }, border: thinBorder };
  const S_TOTAL_LBL = { font: { bold: true, sz: 9 }, alignment: { horizontal: "right" }, border: thinBorder };
  const S_TERMS_HEAD = { font: { bold: true, sz: 9, color: { rgb: "B91C1C" }, underline: true }, border: thinBorder };
  const S_TERMS   = { font: { sz: 9 }, alignment: { vertical: "top" }, border: thinBorder };
  const S_TERMS_BOLD = { font: { bold: true, sz: 9 }, alignment: { vertical: "top" }, border: thinBorder };
  const S_BANNER_TITLE = { font: { bold: true, sz: 16, color: { rgb: "FFFFFF" } }, fill: { patternType: "solid", fgColor: { rgb: "F59E0B" } }, alignment: { horizontal: "center", vertical: "center" } };
  const S_BANNER  = { font: { sz: 9, color: { rgb: "FFFFFF" } }, fill: { patternType: "solid", fgColor: { rgb: "F59E0B" } }, alignment: { horizontal: "center", vertical: "center" } };

  // ── Row accumulator ──────────────────────────────────────────────────────────
  const printableRows: any[][] = [];
  const merges: any[] = [];
  const styleMap: Record<string, any> = {};

  const pushMerge = (r: number, c1: number, c2: number) =>
    merges.push({ s: { r, c: c1 }, e: { r, c: c2 } });

  const setStyle = (r: number, c: number, style: any) => {
    styleMap[`${r},${c}`] = style;
  };

  const styleRange = (r: number, c1: number, c2: number, style: any) => {
    for (let c = c1; c <= c2; c++) setStyle(r, c, style);
  };

  const addRow = (row: any[]) => {
    while (row.length < COL_COUNT) row.push("");
    printableRows.push(row);
    return printableRows.length - 1;
  };

  // ── Header: Logo rows (Billing To label left, logo/company name right) ──────
  const logoR = addRow((() => {
    const r = blankRow();
    r[0] = "Billing To";
    r[10] = logoPath ? "" : companyName;
    return r;
  })());
  pushMerge(logoR, 0, 8);
  styleRange(logoR, 0, 8, S_BILL_LABEL);
  pushMerge(logoR, 10, LAST_COL);
  styleRange(logoR, 10, LAST_COL, S_LOGO);

  const logoSpacerR = addRow(blankRow());
  pushMerge(logoSpacerR, 0, 8);
  styleRange(logoSpacerR, 0, 8, S_BILL);
  pushMerge(logoSpacerR, 10, LAST_COL);
  styleRange(logoSpacerR, 10, LAST_COL, S_LOGO);

  // Billing + Meta rows: left (cols 0-8), meta label (col 10), meta value (cols 11-13)
  const addHeaderRow = (left: string, leftStyle: any, metaLabel: string, metaValue: string) => {
    const row = blankRow();
    row[0] = left;
    if (metaLabel) row[10] = metaLabel;
    if (metaValue) row[11] = metaValue;
    const ri = addRow(row);
    pushMerge(ri, 0, 8);
    styleRange(ri, 0, 8, leftStyle);
    if (metaLabel) setStyle(ri, 10, S_META_L);
    if (metaValue) { pushMerge(ri, 11, LAST_COL); styleRange(ri, 11, LAST_COL, S_META_V); }
  };

  addHeaderRow(`M/S : ${billingName}`, S_BILL_LABEL, "Date :", dateStr);
  addHeaderRow(wrapAddressForExcel(billingAddr), S_BILL, "Est - No -", estNo);
  addHeaderRow(billingStateCode ? `State Code: ${billingStateCode}` : "", S_BILL, "GSTN -", sellerGstin);
  addHeaderRow(billingGstin ? `GSTN - ${billingGstin}` : "", S_BILL_LABEL, "PAN -", sellerPan);
  addHeaderRow("", S_BILL, estimate.vendorCode ? "Vendor Code -" : "", estimate.vendorCode || "");
  addHeaderRow("Shipping To", S_BILL_LABEL, "", "");
  addHeaderRow(`M/S : ${shippingName}`, S_BILL_LABEL, "", "");
  addHeaderRow(wrapAddressForExcel(shippingAddr), S_BILL, "", "");
  addHeaderRow(billingGstin ? `GSTN - ${billingGstin}` : "", S_BILL_LABEL, "", "");

  // Spacer
  addRow(blankRow());

  // ── Subject row ──────────────────────────────────────────────────────────────
  const subjR = addRow((() => { const r = blankRow(); r[0] = `Subject : ${estimate.subject || estimate.title || ""}`; return r; })());
  pushMerge(subjR, 0, LAST_COL);
  styleRange(subjR, 0, LAST_COL, S_SUBJECT);

  // ── Column header row ────────────────────────────────────────────────────────
  const headR = addRow([
    "SL", "ELEMENT", "HSN", "Standard / Non", "PRODUCT DETAILS",
    "W", "H", "Qty", "T.Sqft", "Rate", "Amount", "GST %", "GST Amount", "Total",
  ]);
  styleRange(headR, 0, LAST_COL, S_HEADER);
  const repeatHeaderStart = headR + 1;

  // ── Build store sections ──────────────────────────────────────────────────────
  type Section = {
    storeName: string;
    storeCode: string;
    storeItems: any[];
    serviceItems: any[];
    packingPercent: number;
    implPercent: number;
    transportAmt: number;
    transportDescription: string;
  };
  const sections: Section[] = [];
  const storeKeys = orderedStoreKeysFromItems(sortedItems, storeGrouping);

  if (storeKeys.length > 0) {
    storeKeys.forEach((sidKey) => {
      const tStore = stores?.find((st: any) => st.id === Number(sidKey));
      const groupData = storeGrouping[sidKey] || [];
      const itemSls = Array.isArray(groupData) ? groupData : (groupData.itemSls || []);
      const groupedItems = sortedItems.filter((it: any) => itemSls.includes(it.sl || 0));
      if (groupedItems.length === 0) return;
      sections.push({
        storeName: tStore?.name || (!Array.isArray(groupData) && groupData.storeName) || `Store ${sidKey}`,
        storeCode: tStore?.storeCode || "",
        storeItems: groupedItems.filter((it: any) => !isServiceItem(it)),
        serviceItems: groupedItems.filter((it: any) => isServiceItem(it)),
        packingPercent: !Array.isArray(groupData) && groupData.packingPercent !== undefined
          ? Number(groupData.packingPercent) : Number(estimate.packingPercent || 0),
        implPercent: !Array.isArray(groupData) && groupData.implementationPercent !== undefined
          ? Number(groupData.implementationPercent) : Number(estimate.implementationPercent || 0),
        transportAmt: !Array.isArray(groupData) && groupData.transportAmount !== undefined
          ? Number(groupData.transportAmount) : 0,
        transportDescription: !Array.isArray(groupData) && groupData.transportDescription
          ? String(groupData.transportDescription) : "Local Transportation",
      });
    });
  }

  if (sections.length === 0) {
    const targetStore = stores?.find((st: any) => st.id === estimate.storeId);
    sections.push({
      storeName: targetStore?.name || s(estimate.title || "Site"),
      storeCode: targetStore?.storeCode || "",
      storeItems: sortedItems.filter((it: any) => !isServiceItem(it)),
      serviceItems: sortedItems.filter((it: any) => isServiceItem(it)),
      packingPercent: Number(estimate.packingPercent || 0),
      implPercent: Number(estimate.implementationPercent || 0),
      transportAmt: Number(estimate.transportAmount || 0),
      transportDescription: "Local Transportation",
    });
  }

  let grandBeforeTax = 0;
  let grandSgst = 0;
  let grandCgst = 0;
  let grandIgst = 0;

  sections.forEach((sec, sIdx) => {
    const storeR = addRow((() => {
      const r = blankRow();
      r[0] = `Store: ${sec.storeName}${sec.storeCode ? `,  Store Code: ${sec.storeCode}` : ""}`;
      return r;
    })());
    pushMerge(storeR, 0, LAST_COL);
    styleRange(storeR, 0, LAST_COL, S_STORE);

    sec.storeItems.forEach((item, idx) => {
      const ri = addRow([
        idx + 1,
        item.itemName || "",
        item.hsn || "",
        item.isStandard ? "Standard" : "Non-standard",
        item.description || "",
        item.width != null ? r2(Number(item.width)) : "",
        item.height != null ? r2(Number(item.height)) : "",
        item.quantity != null ? r2(Number(item.quantity)) : "",
        item.totalSize != null ? r2(Number(item.totalSize)) : "",
        item.rate != null ? r2(Number(item.rate)) : "",
        r2(Number(item.totalPrice) || 0),
        isIgst ? Number(item.igstPercent) || 0 : (Number(item.sgstPercent) || 0) + (Number(item.cgstPercent) || 0),
        r2(isIgst ? Number(item.igstAmount) || 0 : (Number(item.sgstAmount) || 0) + (Number(item.cgstAmount) || 0)),
        r2(Number(item.totalAmount) || 0),
      ]);
      setStyle(ri, 0, S_HEADER);
      styleRange(ri, 1, 4, S_CELL);
      styleRange(ri, 5, LAST_COL, S_NUM);
    });

    const materialBase = sec.storeItems.reduce((sum, it) => sum + Number(it.totalPrice || 0), 0);
    const materialSgst = sec.storeItems.reduce((sum, it) => sum + Number(it.sgstAmount || 0), 0);
    const materialCgst = sec.storeItems.reduce((sum, it) => sum + Number(it.cgstAmount || 0), 0);
    const materialIgst = sec.storeItems.reduce((sum, it) => sum + Number(it.igstAmount || 0), 0);

    const tmcR = addRow((() => {
      const r = blankRow();
      r[1] = "Total Material Cost";
      r[10] = r2(materialBase);
      r[11] = 18;
      r[12] = r2(isIgst ? materialIgst : materialSgst + materialCgst);
      r[13] = r2(materialBase + materialSgst + materialCgst + materialIgst);
      return r;
    })());
    styleRange(tmcR, 0, 9, S_YELLOW);
    styleRange(tmcR, 10, LAST_COL, S_YELLOW_NUM);

    const hasSavedServices = sec.serviceItems.length > 0;
    const packAmt = hasSavedServices
      ? sec.serviceItems.filter(it => it.lineType === "packing").reduce((sum, it) => sum + Number(it.totalPrice || 0), 0)
      : materialBase * (sec.packingPercent / 100);
    const implAmt = hasSavedServices
      ? sec.serviceItems.filter(it => it.lineType === "installation").reduce((sum, it) => sum + Number(it.totalPrice || 0), 0)
      : materialBase * (sec.implPercent / 100);
    const transAmt = hasSavedServices
      ? sec.serviceItems.filter(it => it.lineType === "transport").reduce((sum, it) => sum + Number(it.totalPrice || 0), 0)
      : sec.transportAmt;

    const addServiceRow = (label: string, descr: string, pctLabel: string, base: number) => {
      if (base <= 0) return;
      const ri = addRow((() => {
        const r = blankRow();
        r[1] = label; r[2] = "9987"; r[3] = "Standard"; r[4] = descr;
        r[9] = pctLabel; r[10] = r2(base); r[11] = 18;
        r[12] = r2(base * 0.18); r[13] = r2(base * 1.18);
        return r;
      })());
      setStyle(ri, 0, S_CELL);
      styleRange(ri, 1, 4, S_CELL);
      styleRange(ri, 5, LAST_COL, S_NUM);
    };

    const addSavedServiceRow = (item: any) => {
      const base = Number(item.totalPrice || 0);
      if (base <= 0) return;
      const ri = addRow((() => {
        const r = blankRow();
        r[1] = serviceItemLabel(item); r[2] = item.hsn || "9987";
        r[3] = item.isStandard === false ? "Non-standard" : "Standard";
        r[4] = serviceItemLabel(item); r[7] = r2(Number(item.quantity) || 1);
        r[9] = serviceItemRateLabel(item); r[10] = r2(base);
        r[11] = isIgst ? Number(item.igstPercent) || 0 : (Number(item.sgstPercent) || 0) + (Number(item.cgstPercent) || 0);
        r[12] = r2(isIgst ? Number(item.igstAmount) || 0 : (Number(item.sgstAmount) || 0) + (Number(item.cgstAmount) || 0));
        r[13] = r2(Number(item.totalAmount) || 0);
        return r;
      })());
      setStyle(ri, 0, S_CELL);
      styleRange(ri, 1, 4, S_CELL);
      styleRange(ri, 5, LAST_COL, S_NUM);
    };

    if (hasSavedServices) {
      sec.serviceItems.forEach(addSavedServiceRow);
    } else {
      addServiceRow(`Packing Charges (${sec.packingPercent}%)`, `Packing Charges (${sec.packingPercent}%)`, `${sec.packingPercent}%`, packAmt);
      addServiceRow(`Installation Charges (${sec.implPercent}%)`, `Installation Charges (${sec.implPercent}%)`, `${sec.implPercent}%`, implAmt);
      addServiceRow("Local Transportation", sec.transportDescription || "Local Transportation", "", transAmt);
    }

    if (sIdx < sections.length - 1) addRow(blankRow());

    const savedServiceBase = sec.serviceItems.reduce((sum, it) => sum + Number(it.totalPrice || 0), 0);
    const syntheticServiceBase = hasSavedServices ? 0 : packAmt + implAmt + transAmt;
    grandBeforeTax += materialBase + savedServiceBase + syntheticServiceBase;
    if (isIgst) {
      grandIgst += materialIgst
        + sec.serviceItems.reduce((sum, it) => sum + Number(it.igstAmount || 0), 0)
        + syntheticServiceBase * 0.18;
    } else {
      grandSgst += materialSgst
        + sec.serviceItems.reduce((sum, it) => sum + Number(it.sgstAmount || 0), 0)
        + syntheticServiceBase * 0.09;
      grandCgst += materialCgst
        + sec.serviceItems.reduce((sum, it) => sum + Number(it.cgstAmount || 0), 0)
        + syntheticServiceBase * 0.09;
    }
  });

  const grandTotal = grandBeforeTax + grandSgst + grandCgst + grandIgst;

  // ── Grand TOTAL row ───────────────────────────────────────────────────────────
  const totR = addRow((() => {
    const r = blankRow();
    r[9] = "TOTAL"; r[10] = r2(grandBeforeTax); r[11] = 18;
    r[12] = r2(isIgst ? grandIgst : grandSgst + grandCgst); r[13] = r2(grandTotal);
    return r;
  })());
  styleRange(totR, 9, LAST_COL, S_TOTAL_NUM);

  const stacked = (label: string, value: number) => {
    const r = blankRow();
    r[9] = label; r[13] = r2(value);
    const ri = addRow(r);
    pushMerge(ri, 9, 12);
    styleRange(ri, 9, 12, S_TOTAL_LBL);
    setStyle(ri, 13, S_TOTAL_NUM);
  };
  stacked("TOTAL AMOUNT BEFORE TAX", grandBeforeTax);
  if (isIgst) {
    stacked("Add : IGST 18%", grandIgst);
  } else {
    stacked("Add : CGST 9%", grandCgst);
    stacked("Add : SGST 9%", grandSgst);
  }
  stacked("TOTAL AMOUNT AFTER TAX", grandTotal);

  // Amount in words
  const wordsR = addRow((() => {
    const r = blankRow();
    r[0] = `Amount in Words: ${numberToWords(grandTotal)}`;
    return r;
  })());
  pushMerge(wordsR, 0, LAST_COL);
  setStyle(wordsR, 0, S_TERMS_BOLD);

  // ── Footer: Terms / Bank / Signature ──────────────────────────────────────────
  const termsHeadR = addRow((() => {
    const r = blankRow();
    r[0] = "Terms & Condition :";
    r[5] = "BANK ACCOUNT DETAILS";
    r[10] = `For ${companyName.toUpperCase()}`;
    return r;
  })());
  pushMerge(termsHeadR, 0, 4); styleRange(termsHeadR, 0, 4, S_TERMS_HEAD);
  pushMerge(termsHeadR, 5, 9); styleRange(termsHeadR, 5, 9, S_TERMS_BOLD);
  pushMerge(termsHeadR, 10, LAST_COL); styleRange(termsHeadR, 10, LAST_COL, S_TERMS_BOLD);

  const tcLines: [string, string, string][] = [
    [sellerTerms[0] || "", `Bank Name : ${bankName}`, ""],
    [sellerTerms[1] || "", `Branch Name : ${bankBranch}`, ""],
    [sellerTerms[2] || "", `C.A/c No : ${bankAccount}`, ""],
    [sellerTerms[3] || "", `IFSC NO : ${bankIfsc}`, "Authorised Signatory"],
  ];
  tcLines.forEach(([t, b, sig]) => {
    const ri = addRow((() => {
      const r = blankRow(); r[0] = t; r[5] = b; r[10] = sig; return r;
    })());
    pushMerge(ri, 0, 4); styleRange(ri, 0, 4, S_TERMS);
    pushMerge(ri, 5, 9); styleRange(ri, 5, 9, S_TERMS);
    pushMerge(ri, 10, LAST_COL); styleRange(ri, 10, LAST_COL, sig ? S_TERMS_BOLD : S_TERMS);
  });

  // Spacer
  addRow(blankRow());

  // ── Orange banner ─────────────────────────────────────────────────────────────
  const bannerLine = (text: string, style: any) => {
    const ri = addRow((() => { const r = blankRow(); r[0] = text; return r; })());
    pushMerge(ri, 0, LAST_COL);
    styleRange(ri, 0, LAST_COL, style);
  };
  bannerLine(companyName.toUpperCase(), S_BANNER_TITLE);
  if (sellerAddress) bannerLine(sellerAddress, S_BANNER);
  if (sellerMobile || sellerEmail) bannerLine([sellerMobile, sellerEmail].filter(Boolean).join("  ·  "), S_BANNER);

  // ── Build worksheet ───────────────────────────────────────────────────────────
  const ws = XLSX.utils.aoa_to_sheet(printableRows);
  ws["!merges"] = merges;

  // Apply styles
  Object.keys(styleMap).forEach((key) => {
    const [row, col] = key.split(",").map(Number);
    const addr = XLSX.utils.encode_cell({ r: row, c: col });
    if (!ws[addr]) ws[addr] = { t: "s", v: "" };
    (ws[addr] as any).s = styleMap[key];
  });

  // Column widths
  ws["!cols"] = [
    { wch: 5 },   // SL
    { wch: 22 },  // ELEMENT
    { wch: 8 },   // HSN
    { wch: 13 },  // Standard/Non
    { wch: 34 },  // PRODUCT DETAILS
    { wch: 7 },   // W
    { wch: 7 },   // H
    { wch: 7 },   // Qty
    { wch: 9 },   // T.Sqft
    { wch: 9 },   // Rate
    { wch: 11 },  // Amount
    { wch: 8 },   // GST %
    { wch: 13 },  // GST Amount
    { wch: 12 },  // Total
  ];

  // Row heights
  ws["!rows"] = printableRows.map((_row, idx) => {
    if (idx === logoR || idx === logoSpacerR) return { hpt: 28 };
    if (idx === headR) return { hpt: 22 };
    const leftText = String(_row[0] || "");
    const lines = Math.max(1, (leftText.match(/\n/g) || []).length + 1, Math.ceil(leftText.length / 100));
    if (Math.min(lines, 2) >= 2) return { hpt: 32 };
    return { hpt: 16 };
  });

  // Page setup
  (ws as any)["!pageSetup"] = {
    paperSize: 9, orientation: "landscape", fitToWidth: 1, fitToHeight: 0, horizontalCentered: true,
  };
  (ws as any)["!margins"] = { left: 0.25, right: 0.25, top: 0.35, bottom: 0.45, header: 0.2, footer: 0.2 };
  (ws as any)["!freeze"] = {
    xSplit: 0, ySplit: repeatHeaderStart, topLeftCell: `A${repeatHeaderStart + 1}`,
    activePane: "bottomLeft", state: "frozen",
  };
  (ws as any)["!autofilter"] = {
    ref: XLSX.utils.encode_range({ s: { r: headR, c: 0 }, e: { r: headR, c: LAST_COL } }),
  };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Estimate");

  const rawBuf: ArrayBuffer = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  let finalBytes = new Uint8Array(rawBuf);

  if (logoPath) {
    finalBytes = await embedLogoInWorkbook(
      finalBytes,
      logoPath,
      { fromCol: 10, toCol: 14, fromRow: logoR, toRow: logoSpacerR + 1 },
    );
  }

  const fileName = `Estimate_${estNo.replace(/[\/\\:*?"<>|]+/g, "-")}.xlsx`;
  downloadBlob(
    new Blob([finalBytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    fileName,
  );
}
