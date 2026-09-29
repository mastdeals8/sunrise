import React, { useMemo } from "react";
import { formatCurrency } from "@/utils/format";
import { orderedStoreKeysFromGrouping } from "../pages/operations/utils/estimateOrdering";

export interface InvoiceSummaryRow {
  field: string;
  value: string;
}

interface InvoiceSummaryDocumentProps {
  packet: any;
  sellerProfile?: any;
  pages?: any[];
}

export function getInvoiceSummaryRows(packet: any, sellerProfile: any, pages?: any[]): InvoiceSummaryRow[] {
  if (!packet) return [];

  // 1. PO No
  const poNo = String(packet.invoice?.poNumber || packet.estimate?.poNumber || "").trim() || "—";

  // 2. Invoice No
  const invoiceNo = String(packet.invoice?.invoiceNumber || "").trim() || "—";

  // 3. Invoice Amt Post GST
  const rawTotal = packet.invoice?.totalAmount != null ? Number(packet.invoice.totalAmount) : 0;
  const invoiceAmtPostGst = formatCurrency(rawTotal);

  // 4. Invoice Date
  const rawDate = packet.invoice?.date;
  let invoiceDate = "—";
  if (rawDate) {
    const d = new Date(rawDate);
    if (!isNaN(d.getTime())) {
      invoiceDate = d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
    } else {
      invoiceDate = String(rawDate);
    }
  }

  // 5. Activity
  const activity = String(
    packet.estimate?.title ||
    packet.estimate?.subject ||
    packet.invoice?.title ||
    packet.invoice?.subject ||
    packet.invoice?.remarks ||
    "—"
  ).trim() || "—";

  // 6. Store & 8. No of Stores
  const estimateGrouping = (packet.estimate?.storeGrouping || {}) as Record<string, any>;
  const orderedSids = orderedStoreKeysFromGrouping(estimateGrouping);

  const storeCodesList: string[] = [];
  const storeNamesList: string[] = [];

  const registerStore = (code: string, name: string) => {
    const cleanCode = String(code || "").trim();
    if (!cleanCode || storeCodesList.includes(cleanCode)) return;
    storeCodesList.push(cleanCode);
    storeNamesList.push(String(name || cleanCode).trim());
  };

  if (orderedSids.length > 0) {
    orderedSids.forEach(sid => {
      const master = (packet.stores || []).find((s: any) => s.id === Number(sid));
      const code = String(master?.storeCode || (master as any)?.code || sid).trim();
      const name = master?.name || code;
      registerStore(code, name);
    });
  }

  (packet.executionStores || []).forEach((es: any) => {
    const code = String(es.code || es.storeCode || "").trim();
    const name = es.name || es.storeName || code;
    registerStore(code, name);
  });

  (packet.challans || []).forEach((dc: any) => {
    const code = String(dc.storeCode || dc.metadata?.storeCode || "").trim();
    const name = dc.metadata?.storeName || code;
    registerStore(code, name);
  });

  if (storeCodesList.length === 0 && packet.estimate?.storeId) {
    const master = (packet.stores || []).find((s: any) => s.id === Number(packet.estimate.storeId));
    if (master) {
      const code = String(master.storeCode || (master as any)?.code || master.id).trim();
      registerStore(code, master.name || code);
    }
  }

  const noOfStoresCount = storeCodesList.length;
  const noOfStores = String(noOfStoresCount);
  const store = noOfStoresCount > 1 ? "Multiple" : noOfStoresCount === 1 ? (storeNamesList[0] || "—") : "—";

  // 7. Vendor
  const vendor = String(sellerProfile?.name || sellerProfile?.companyName || "Sunrise Media").trim();

  // 9. WCC
  let wccStatus = "Pending";
  if (noOfStoresCount === 0) {
    wccStatus = "Not Applicable";
  } else {
    let allWccComplete = true;
    for (const sc of storeCodesList) {
      const hasWcc =
        (pages || []).some(
          p =>
            p.kind === "wcc" &&
            (p.filePath || p.storagePath) &&
            (storeCodesList.length === 1 || String(p.storeCode || "").trim() === sc)
        ) ||
        (packet.executionDocuments || []).some(
          (d: any) =>
            ["signed_wcc", "signed_dc"].includes(d.documentType) &&
            d.status !== "deleted" &&
            (d.filePath || d.storagePath) &&
            (storeCodesList.length === 1 || String(d.storeCode || "").trim() === sc)
        ) ||
        (packet.challans || []).some(
          (dc: any) =>
            Boolean(dc.signedChallanPath) &&
            (storeCodesList.length === 1 || String(dc.storeCode || dc.metadata?.storeCode || "").trim() === sc)
        );
      if (!hasWcc) {
        allWccComplete = false;
        break;
      }
    }
    wccStatus = allWccComplete ? "OK" : "Pending";
  }

  // 10. Photo Proof
  let photoStatus = "Pending";
  if (noOfStoresCount === 0) {
    photoStatus = "Not Applicable";
  } else {
    let allPhotosComplete = true;
    for (const sc of storeCodesList) {
      const hasPhoto =
        (pages || []).some(
          p =>
            p.kind === "photo" &&
            (p.filePath || p.storagePath) &&
            (storeCodesList.length === 1 || String(p.storeCode || "").trim() === sc)
        ) ||
        (packet.executionDocuments || []).some(
          (d: any) =>
            ["photo", "installation_photo", "execution_photo", "completion_photo", "additional_photo"].includes(d.documentType) &&
            d.status !== "deleted" &&
            (d.filePath || d.storagePath) &&
            (storeCodesList.length === 1 || String(d.storeCode || "").trim() === sc)
        ) ||
        (packet.challans || []).some(
          (dc: any) =>
            (Boolean(dc.photoPath) || (Array.isArray(dc.metadata?.photos) && dc.metadata.photos.length > 0)) &&
            (storeCodesList.length === 1 || String(dc.storeCode || dc.metadata?.storeCode || "").trim() === sc)
        );
      if (!hasPhoto) {
        allPhotosComplete = false;
        break;
      }
    }
    photoStatus = allPhotosComplete ? "OK" : "Pending";
  }

  // 11. Transport Bill & 12. Transport Mode
  const hasTransportItem =
    (packet.estimateItems || []).some(
      (it: any) => it.lineType === "transport" || (it.itemName && it.itemName.toLowerCase().includes("transport"))
    ) ||
    (packet.invoice?.lineItems || []).some(
      (it: any) => it.lineType === "transport" || (it.itemName && it.itemName.toLowerCase().includes("transport"))
    );

  const hasTransportAmount =
    Number(packet.estimate?.transportAmount || 0) > 0 || Number(packet.invoice?.transportCost || 0) > 0;

  const hasStoreTransport = Object.values(packet.estimate?.storeGrouping || {}).some(
    (g: any) =>
      Number(g?.transportAmount) > 0 ||
      Number(g?.transportKm) > 0 ||
      (g?.transportType && g?.transportType !== "none" && g?.transportType !== "null")
  );

  const hasTransportDoc =
    (pages || []).some(
      p =>
        p.kind === "project" &&
        (p.filePath || p.storagePath) &&
        (p.label.toLowerCase().includes("transport") ||
          p.label.toLowerCase().includes("courier") ||
          p.label.toLowerCase().includes("lr copy") ||
          p.label.toLowerCase().includes("gate pass") ||
          p.label.toLowerCase().includes("eway"))
    ) ||
    (packet.executionDocuments || []).some(
      (d: any) =>
        ["transport_receipt", "lr_copy", "courier_receipt", "gate_pass", "eway_bill"].includes(d.documentType) &&
        d.status !== "deleted" &&
        (d.filePath || d.storagePath)
    ) ||
    (packet.challans || []).some((dc: any) => Boolean(dc.transportReceiptPath));

  const isTransportApplicable = hasTransportItem || hasTransportAmount || hasStoreTransport || hasTransportDoc;

  let transportBill = "Not Applicable";
  let transportMode = "Not Applicable";

  if (isTransportApplicable) {
    transportBill = hasTransportDoc ? "Attached" : "Pending";

    let savedMode: string | null = null;
    // 1. Check storeGrouping
    for (const g of Object.values(packet.estimate?.storeGrouping || {}) as any[]) {
      if (g?.transportType === "outstation") {
        savedMode = "Outstation";
        break;
      }
      if (g?.transportType === "local") {
        savedMode = "Local";
      }
      if (g?.transportDescription && String(g.transportDescription).trim()) {
        savedMode = String(g.transportDescription).trim();
        break;
      }
    }

    // 2. Check estimate/invoice items
    if (!savedMode || savedMode === "Local") {
      const tItem = [...(packet.estimateItems || []), ...(packet.invoice?.lineItems || [])].find(
        (it: any) => it.lineType === "transport" || (it.itemName && it.itemName.toLowerCase().includes("transport"))
      );
      if (tItem) {
        const itemName = String(tItem.itemName || "").trim();
        const desc = String(tItem.description || "").trim();
        const unit = String(tItem.unit || "").trim().toLowerCase();
        if (unit === "km" || itemName.toLowerCase().includes("outstation") || desc.toLowerCase().includes("outstation")) {
          savedMode = "Outstation";
        } else if (itemName.toLowerCase().includes("local") || desc.toLowerCase().includes("local") || unit === "job") {
          savedMode = "Local";
        } else if (itemName) {
          savedMode = itemName;
        }
      }
    }

    // 3. Check deliveryChallans deliveredBy
    if (!savedMode) {
      const dcWithDelivered = (packet.challans || []).find((dc: any) => dc.deliveredBy && String(dc.deliveredBy).trim());
      if (dcWithDelivered) {
        savedMode = String(dcWithDelivered.deliveredBy).trim();
      }
    }

    transportMode = savedMode || "Local";
  }

  return [
    { field: "PO No", value: poNo },
    { field: "Invoice No", value: invoiceNo },
    { field: "Invoice Amt Post GST", value: invoiceAmtPostGst },
    { field: "Invoice Date", value: invoiceDate },
    { field: "Activity", value: activity },
    { field: "Store", value: store },
    { field: "Vendor", value: vendor },
    { field: "No of Stores", value: noOfStores },
    { field: "WCC", value: wccStatus },
    { field: "Photo Proof", value: photoStatus },
    { field: "Transport Bill", value: transportBill },
    { field: "Transport Mode", value: transportMode },
  ];
}

const InvoiceSummaryDocument: React.FC<InvoiceSummaryDocumentProps> = ({ packet, sellerProfile, pages }) => {
  const rows = useMemo(() => getInvoiceSummaryRows(packet, sellerProfile, pages), [packet, sellerProfile, pages]);

  if (!packet) return null;

  return (
    <div
      className="summary-print bg-white text-black"
      style={{
        width: "100%",
        maxWidth: "800px",
        margin: "0 auto",
        backgroundColor: "#ffffff",
        color: "#000000",
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        boxSizing: "border-box",
        padding: "36px 32px",
        minHeight: "750px",
      }}
    >
      <div style={{ maxWidth: "600px", margin: "20px auto 0 auto" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            border: "1.5px solid #000000",
            backgroundColor: "#ffffff",
            fontSize: "11px",
            lineHeight: 1.35,
          }}
        >
          <thead>
            <tr>
              <th
                style={{
                  border: "1px solid #000000",
                  padding: "7px 12px",
                  textAlign: "center",
                  verticalAlign: "middle",
                  fontWeight: 700,
                  backgroundColor: "#ffffff",
                  color: "#000000",
                  width: "45%",
                  letterSpacing: "0.2px",
                }}
              >
                Field
              </th>
              <th
                style={{
                  border: "1px solid #000000",
                  padding: "7px 12px",
                  textAlign: "center",
                  verticalAlign: "middle",
                  fontWeight: 700,
                  backgroundColor: "#ffffff",
                  color: "#000000",
                  width: "55%",
                  letterSpacing: "0.2px",
                }}
              >
                Value
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index} data-pdf-row>
                <td
                  style={{
                    border: "1px solid #000000",
                    padding: "6.5px 12px",
                    textAlign: "center",
                    verticalAlign: "middle",
                    fontWeight: 600,
                    color: "#000000",
                    backgroundColor: "#ffffff",
                  }}
                >
                  {row.field}
                </td>
                <td
                  style={{
                    border: "1px solid #000000",
                    padding: "6.5px 12px",
                    textAlign: "center",
                    verticalAlign: "middle",
                    fontWeight: 500,
                    color: "#000000",
                    backgroundColor: "#ffffff",
                  }}
                >
                  {row.value}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default InvoiceSummaryDocument;
