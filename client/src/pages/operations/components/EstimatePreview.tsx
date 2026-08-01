import React from "react";
import { isBoltMode } from "../../../lib/supabase";
import { fetchExecutionStores, createInvoice, uploadToStorage, registerExecutionDocument, openExecutionDocument } from "../../../lib/api";
import { AlertTriangle, Briefcase, Camera, CheckCircle2, ChevronRight, Copy, Download, Edit3, Eye, File, FileCheck2, FilePlus, FileSpreadsheet, FileText, FileUp, Image as ImageIcon, Paperclip, Pen, Plus, Printer, ScanLine, Store as StoreIcon, Upload, X } from "lucide-react";
import { isAblblFormat } from "../../../../../shared/textFormat";
import { formatCurrency } from "../utils/formatters";
import { orderedEstimateItems, orderedStoreKeysFromItems } from "../utils/estimateOrdering";
import { exportEstimateToExcel } from "../utils/exportHelpers";
import type { Brand, Client, Estimate, EstimateItem, Product, Store } from "../types";
import EstimateDocument from "../../../components/EstimateDocument";

interface EstimatePreviewProps {
  clients: Client[];
  brands: Brand[];
  stores: Store[];
  products: Product[];
  selectedEstimate?: Estimate | null;
  selectedEstimateItems?: EstimateItem[];
  selectedChallans?: any[];
  [key: string]: any;
}

const SERVICE_LINE_TYPES = new Set(["packing", "installation", "transport"]);

const isServiceItem = (item: EstimateItem) =>
  SERVICE_LINE_TYPES.has(String(item.lineType || "").toLowerCase());

const serviceRateValue = (item: EstimateItem) => Number(item.rate) || 0;

const serviceLabel = (item: EstimateItem) => {
  const lineType = String(item.lineType || "").toLowerCase();
  const rate = serviceRateValue(item);
  if (lineType === "packing") return rate > 0 ? `Packing Charges (${rate}%)` : "Packing Charges";
  if (lineType === "installation") return rate > 0 ? `Installation Charges (${rate}%)` : "Installation Charges";
  if (lineType === "transport" && String(item.unit || "").toLowerCase() === "km") {
    return rate > 0 ? `Outstation Transportation (₹${rate}/KM)` : "Outstation Transportation";
  }
  if (lineType === "transport") return "Local Transportation";
  return item.itemName || "";
};


type ExecutionStoreRow = {
  id: number;
  estimateId: number;
  storeCode: string;
  storeName?: string | null;
  storeLocation?: string | null;
  storeCity?: string | null;
  storeState?: string | null;
  status: string;
  source?: string | null;
  stats?: {
    wccCount: number;
    dcCount: number;
    photoCount: number;
    signedWccCount: number;
    signedDcCount: number;
    documentCount: number;
  };
  documents?: any[];
  wccRecords?: any[];
  dcRecords?: any[];
  signedWccDocuments?: any[];
  photoDocuments?: any[];
};

type ExecutionDocumentRow = {
  id: number;
  estimateId: number;
  deliveryChallanId: number | null;
  storeCode: string | null;
  documentType: string;
  filePath: string;
  originalFileName: string | null;
  mimeType: string | null;
  fileSize: number | null;
  status: string;
  version: number;
  uploadedBy?: string | null;
  uploadedVia: string | null;
  uploadedAt: string | null;
  createdAt: string;
  updatedAt?: string | null;
  metadata: any | null;
};

const executionStatusLabel = (status: string) => {
  const labels: Record<string, string> = {
    pending_execution: "Pending Execution",
    pending: "Pending",
    photos_uploaded: "Photos Uploaded",
    wcc_generated: "WCC Generated",
    signed_wcc_received: "Signed WCC Received",
    documents_generated: "Documents Generated",
    signed_received: "Signed Received",
    in_progress: "In Progress",
    completed: "Completed",
    blocked: "Blocked",
    completed_pending_photos: "Completed, Photos Pending",
    proof_received: "Proof Received",
  };
  return labels[status] || String(status || "Pending Execution").replace(/_/g, " ");
};

const labelForDocumentType = (type: string) => {
  const map: Record<string, string> = {
    po: "Purchase Order",
    photo: "Photo",
    dc: "Delivery Challan",
    wcc: "WCC",
    signed_wcc: "Signed WCC",
    signed_dc: "Signed DC",
    transport_receipt: "Transport Receipt",
    extra: "Extra Document",
    field_upload: "Field Upload",
  };
  return map[type] || type.replace(/_/g, " ");
};

const fileNameForDoc = (doc: Partial<ExecutionDocumentRow>) =>
  doc.originalFileName || String(doc.filePath || "").split("/").pop() || "Document";

const isImageDoc = (doc: Partial<ExecutionDocumentRow>) =>
  Boolean((doc.mimeType && doc.mimeType.startsWith("image/")) || /\.(png|jpe?g|gif|webp)$/i.test(fileNameForDoc(doc)));

const isPdfDoc = (doc: Partial<ExecutionDocumentRow>) =>
  Boolean(doc.mimeType === "application/pdf" || /\.pdf$/i.test(fileNameForDoc(doc)));

const documentUrl = (path?: string | null) => {
  if (!path) return "";
  if (/^(https?:)?\/\//i.test(path) || path.startsWith("/")) return path;
  return `/${path.replace(/^\/+/, "")}`;
};

const documentImageUrl = (doc: Partial<ExecutionDocumentRow>) => {
  const metaPhotoPath = (doc.metadata as any)?.photo?.path;
  return documentUrl(metaPhotoPath || doc.filePath);
};

const formatBytes = (b?: number | null) => {
  if (!b) return "";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
};

const formatShortDateTime = (value?: string | null) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const formatShortDate = (value?: string | null) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

const executionStatusClass = (status: string) => {
  if (["signed_received", "signed_wcc_received", "completed", "proof_received"].includes(status)) return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (["documents_generated", "wcc_generated", "photos_uploaded", "in_progress"].includes(status)) return "bg-blue-50 text-blue-700 border-blue-200";
  if (status === "blocked") return "bg-red-50 text-red-700 border-red-200";
  return "bg-slate-50 text-slate-600 border-slate-200";
};

const deriveStoreExecutionStage = (row: ExecutionStoreRow) => {
  const generated = ((row.stats?.wccCount || 0) + (row.stats?.dcCount || 0)) > 0;
  const photos = (row.stats?.photoCount || 0) > 0;
  const signed = ((row.stats?.signedWccCount || 0) + (row.stats?.signedDcCount || 0)) > 0;
  if (row.status === "blocked") return "Blocked";
  if (row.status === "completed" || (generated && photos && signed)) return "Completed";
  if (generated || photos || signed || (row.stats?.documentCount || 0) > 0) return "In Progress";
  return "Pending";
};

const executionStageClass = (stage: string) => {
  if (stage === "Completed") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (stage === "In Progress") return "bg-blue-50 text-blue-700 border-blue-200";
  if (stage === "Blocked") return "bg-red-50 text-red-700 border-red-200";
  return "bg-slate-50 text-slate-600 border-slate-200";
};

const iconButtonClass = "inline-flex h-7 w-7 items-center justify-center rounded border border-slate-200 bg-white text-slate-600 hover:border-orange-200 hover:bg-orange-50 hover:text-orange-700 disabled:opacity-35 disabled:hover:bg-white disabled:hover:text-slate-600 transition";

const documentIconForGroup = (group: string) => {
  if (group === "Photos") return <Camera className="w-3.5 h-3.5 text-orange-600" />;
  if (group === "PO") return <Paperclip className="w-3.5 h-3.5 text-purple-600" />;
  if (group === "Signed WCC") return <FileCheck2 className="w-3.5 h-3.5 text-emerald-600" />;
  if (group === "WCC" || group === "Delivery Challan") return <FileText className="w-3.5 h-3.5 text-blue-600" />;
  return <File className="w-3.5 h-3.5 text-slate-500" />;
};

const latestTimestampForStore = (row: ExecutionStoreRow) => {
  const dates = [
    ...(row.documents || []).map(doc => doc.updatedAt || doc.uploadedAt || doc.createdAt),
    ...(row.wccRecords || []).map(wcc => wcc.updatedAt || wcc.createdAt),
    ...(row.dcRecords || []).map(dc => dc.updatedAt || dc.createdAt),
  ].filter(Boolean);
  return dates.sort((a, b) => new Date(String(b)).getTime() - new Date(String(a)).getTime())[0] || null;
};

const latestActivityForStore = (row: ExecutionStoreRow) => {
  const entries = [
    ...(row.documents || []).map(doc => ({
      label: `${labelForDocumentType(doc.documentType)} uploaded`,
      date: doc.updatedAt || doc.uploadedAt || doc.createdAt,
    })),
    ...(row.wccRecords || []).map(wcc => ({ label: `WCC ${wcc.dcNumber} generated`, date: wcc.updatedAt || wcc.createdAt })),
    ...(row.dcRecords || []).map(dc => ({ label: `DC ${dc.dcNumber} generated`, date: dc.updatedAt || dc.createdAt })),
  ].filter(entry => entry.date);
  return entries.sort((a, b) => new Date(String(b.date)).getTime() - new Date(String(a.date)).getTime())[0] || null;
};


const PRINT_OPTIONS_STORAGE_KEY = "sunrise_estimate_print_options";
const PRINT_LAYOUT_VALUES = ["portrait", "landscape"] as const;
const PRINT_MODE_VALUES = ["normal", "compact"] as const;

type EstimatePrintLayout = typeof PRINT_LAYOUT_VALUES[number];
type EstimatePrintMode = typeof PRINT_MODE_VALUES[number];
type EstimatePrintOptions = {
  layout: EstimatePrintLayout;
  scale: string;
  mode: EstimatePrintMode;
};

const DEFAULT_PRINT_OPTIONS: EstimatePrintOptions = {
  layout: "portrait",
  scale: "100",
  mode: "compact",
};

const clampPrintScale = (value: any) => {
  const parsed = Number(String(value ?? "").replace(/%/g, ""));
  if (!Number.isFinite(parsed)) return DEFAULT_PRINT_OPTIONS.scale;
  return String(Math.min(120, Math.max(50, Math.round(parsed))));
};

const normalizePrintOptions = (value: any): EstimatePrintOptions => ({
  layout: (PRINT_LAYOUT_VALUES as readonly string[]).includes(value?.layout) ? value.layout : DEFAULT_PRINT_OPTIONS.layout,
  scale: clampPrintScale(value?.scale),
  mode: (PRINT_MODE_VALUES as readonly string[]).includes(value?.mode) ? value.mode : DEFAULT_PRINT_OPTIONS.mode,
});

const loadPrintOptions = (): EstimatePrintOptions => {
  if (typeof window === "undefined") return DEFAULT_PRINT_OPTIONS;
  try {
    return normalizePrintOptions(JSON.parse(window.localStorage.getItem(PRINT_OPTIONS_STORAGE_KEY) || "{}"));
  } catch {
    return DEFAULT_PRINT_OPTIONS;
  }
};

const printOptionsStorageKey = (userKey?: string | number | null) =>
  `${PRINT_OPTIONS_STORAGE_KEY}:${String(userKey || "default")}`;

const loadPrintOptionsForUser = (userKey?: string | number | null): EstimatePrintOptions => {
  if (typeof window === "undefined") return DEFAULT_PRINT_OPTIONS;
  const scopedKey = printOptionsStorageKey(userKey);
  try {
    const scoped = window.localStorage.getItem(scopedKey);
    if (scoped) return normalizePrintOptions(JSON.parse(scoped));
    return normalizePrintOptions(JSON.parse(window.localStorage.getItem(PRINT_OPTIONS_STORAGE_KEY) || "{}"));
  } catch {
    return DEFAULT_PRINT_OPTIONS;
  }
};

const clearPrintOptionClasses = () => {
  if (typeof document === "undefined") return;
  const classes = [
    ...PRINT_LAYOUT_VALUES.map(value => `estimate-print-layout-${value}`),
    ...PRINT_MODE_VALUES.map(value => `estimate-print-mode-${value}`),
  ];
  document.body.classList.remove(...classes);
  document.getElementById("estimate-print-options-style")?.remove();
};

const applyPrintOptionClasses = (options: EstimatePrintOptions) => {
  if (typeof document === "undefined") return;
  clearPrintOptionClasses();
  const style = document.createElement("style");
  style.id = "estimate-print-options-style";
  style.textContent = `@media print { @page { size: A4 ${options.layout}; margin: 8mm; } }`;
  document.head.appendChild(style);
  document.body.classList.add(
    `estimate-print-layout-${options.layout}`,
    `estimate-print-mode-${options.mode}`,
  );
};

const EstimatePreview: React.FC<EstimatePreviewProps> = ({
  clients,
  brands,
  stores,
  products,
  selectedEstimate,
  setSelectedEstimate,
  handleUpdateStatus,
  setPoAmount,
  setShowPoModal,
  openPoForEstimate,
  handleOpenDcModal,
  token,
	  selectedEstimateItems,
		  selectedEstimateItemsLoading = false,
		  selectedChallans = [],
		  invoices = [],
		  initialProjectTab = "overview",
	  handleDuplicateEstimate,
	  openInvoiceEditor,
  openDcPreview,
  openDcForEdit,
  openExecutionDocumentViewer,
  openExecutionDocumentHistoryViewer,
  deleteDeliveryChallan,
  deleteExecutionDocument,
  printDc,
  handleUpdateDcFiles,
  handleFileUpload,
  onInvoiceGenerated,
  sellerProfile = { name: "Sunrise Media", gstin: "", pan: "", state: "Maharashtra", stateCode: "27", address: "" },
	  printSettingsUserKey = "default",
	  presentation = "modal",
	  previewMode = "estimate",
	  onBackToProjects,
		}) => {
          const [brokenImageDocs, setBrokenImageDocs] = React.useState<Record<number, boolean>>({});
            type ProjectTab = "overview" | "po" | "execution" | "documents" | "invoice";
		        const [activeProjectTab, setActiveProjectTab] = React.useState<ProjectTab>(initialProjectTab);
	        const [copyStatus, setCopyStatus] = React.useState("");
          const [showEstimateDocument, setShowEstimateDocument] = React.useState(false);
          const [openDocSections, setOpenDocSections] = React.useState<string[]>(["PO", "Photos", "WCC", "Signed WCC", "Transport", "Extra", "Delivery Challan"]);
          const [documentStoreFilter, setDocumentStoreFilter] = React.useState("all");
          const [documentTypeFilter, setDocumentTypeFilter] = React.useState("all");
          const [executionStores, setExecutionStores] = React.useState<ExecutionStoreRow[]>([]);
          const [executionStoresLoading, setExecutionStoresLoading] = React.useState(false);
          const [selectedExecutionStore, setSelectedExecutionStore] = React.useState<ExecutionStoreRow | null>(null);
          const [generatingInvoice, setGeneratingInvoice] = React.useState(false);
	        const [printOptions, setPrintOptions] = React.useState<EstimatePrintOptions>(() => loadPrintOptionsForUser(printSettingsUserKey));
	        const printCleanupRef = React.useRef<(() => void) | null>(null);
	        const detailItemsReady = !selectedEstimateItemsLoading && (selectedEstimateItems?.length || 0) > 0;
          const previewItems = selectedEstimateItems || [];
          const previewStoreGrouping = (selectedEstimate?.storeGrouping as Record<string, any>) || {};
          const previewStoreKeys = selectedEstimate ? orderedStoreKeysFromItems(orderedEstimateItems(previewItems), previewStoreGrouping) : [];
          const previewStoreCount = previewStoreKeys.length || (selectedEstimate?.storeId ? 1 : 0);
          const activeSelectedChallans = selectedChallans.filter((dc: any) => dc.status !== "deleted" && !dc.metadata?.deleted);
          const previewRowCount = previewItems.length;
          const isProjectWorkspace = previewMode === "project";
          const isPageWorkspace = presentation === "page";
          const toggleDocSection = (key: string) => {
            setOpenDocSections(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
          };
          React.useEffect(() => {
            const onEscape = (event: KeyboardEvent) => {
              if (event.key !== "Escape") return;
              if (selectedExecutionStore) {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
                setSelectedExecutionStore(null);
              }
            };
            window.addEventListener("keydown", onEscape, true);
            return () => window.removeEventListener("keydown", onEscape, true);
          }, [selectedExecutionStore]);
          const refreshExecutionStores = React.useCallback(async () => {
            if (!selectedEstimate?.id || !token) {
              setExecutionStores([]);
              return;
            }
            setExecutionStoresLoading(true);
            try {
              if (isBoltMode) {
                const rows = await fetchExecutionStores(token, selectedEstimate.id);
                setExecutionStores(rows as any[]);
                setSelectedExecutionStore((prev: any) => prev ? (rows as any[]).find((row: any) => row.id === prev.id) || null : null);
              } else {
                const res = await fetch(`/api/operations/execution-stores?estimateId=${selectedEstimate.id}`, {
                  headers: { Authorization: `Bearer ${token}` },
                });
                if (res.ok) {
                  const rows = await res.json();
                  setExecutionStores(rows);
                  setSelectedExecutionStore((prev: any) => prev ? rows.find((row: any) => row.id === prev.id) || null : null);
                }
              }
            } catch {
              setExecutionStores([]);
            } finally {
              setExecutionStoresLoading(false);
            }
          }, [selectedEstimate?.id, token]);

		        React.useEffect(() => {
			          setCopyStatus("");
	              setShowEstimateDocument(previewMode !== "project");
	              setActiveProjectTab(initialProjectTab);
              setDocumentStoreFilter("all");
              setDocumentTypeFilter("all");
			        }, [selectedEstimate?.id, initialProjectTab, previewMode]);

          React.useEffect(() => {
            refreshExecutionStores();
          }, [refreshExecutionStores]);

          const findPrimaryWcc = (storeRow: ExecutionStoreRow | null) => {
            const records = storeRow?.wccRecords || [];
            return records[0] || null;
          };

          const handleStorePhotoUpload = (storeRow: ExecutionStoreRow, e: React.ChangeEvent<HTMLInputElement>) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            const wcc = findPrimaryWcc(storeRow);
            if (wcc && handleFileUpload && handleUpdateDcFiles) {
              handleFileUpload({ target: { files: [file] } } as any, `photo_${wcc.id}`, async (path: string) => {
                await handleUpdateDcFiles(wcc.id, "photoPath", path);
                await refreshExecutionStores();
              });
            }
          };

          const handleStoreSignedWccUpload = (storeRow: ExecutionStoreRow, e: React.ChangeEvent<HTMLInputElement>) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            const wcc = findPrimaryWcc(storeRow);
            if (wcc && handleFileUpload && handleUpdateDcFiles) {
              handleFileUpload({ target: { files: [file] } } as any, `signed_${wcc.id}`, async (path: string) => {
                await handleUpdateDcFiles(wcc.id, "signedChallanPath", path);
                await refreshExecutionStores();
              });
            }
          };

          const estimateItemsToInvoiceLines = (items: EstimateItem[]) => items.map((it) => {
            const qty = Number(it.quantity || 0);
            const rate = Number(it.rate || 0);
            const amount = +(qty * rate).toFixed(2);
            const taxPercent = (Number(it.cgstPercent || 0) + Number(it.sgstPercent || 0)) || Number(it.igstPercent || 0) || 18;
            const taxAmount = Number(it.cgstAmount || 0) + Number(it.sgstAmount || 0) + Number(it.igstAmount || 0);
            return {
              itemName: it.itemName || "",
              description: it.description || "",
              hsn: it.hsn || "",
              quantity: qty,
              unit: it.unit || "nos",
              rate,
              taxPercent,
              amount,
              taxAmount: +taxAmount.toFixed(2),
              totalAmount: +(amount + taxAmount).toFixed(2),
            };
          });

          React.useEffect(() => {
            const options = loadPrintOptionsForUser(printSettingsUserKey);
            setPrintOptions(options);
          }, [printSettingsUserKey]);

	        React.useEffect(() => {
	          return () => {
	            if (printCleanupRef.current) printCleanupRef.current();
	            clearPrintOptionClasses();
	          };
	        }, []);

        const buildSummaryRows = (est: Estimate, items: EstimateItem[]) => {
          const targetStore = stores.find(s => s.id === est.storeId);
          const sortedItems = orderedEstimateItems(items);
          const storeGrouping = (est.storeGrouping as Record<string, any>) || {};
          const storeKeys = orderedStoreKeysFromItems(sortedItems, storeGrouping);
          const subject = est.subject || est.title || "Estimate Work";
          const sectionDefs = storeKeys.length > 0
            ? storeKeys.map((sidKey, index) => {
                const groupData = storeGrouping[sidKey] || [];
                const itemSls = Array.isArray(groupData) ? groupData : (groupData.itemSls || []);
                const storeItems = sortedItems.filter(it => itemSls.includes(it.sl || 0));
                const materialItems = storeItems.filter(it => !isServiceItem(it));
                const serviceItems = storeItems.filter(isServiceItem);
                const store = stores.find(s => s.id === Number(sidKey));
                return {
                  srNo: index + 1,
                  storeCode: store?.storeCode || storeItems.find(it => it.storeCode)?.storeCode || sidKey,
                  materialItems,
                  serviceItems,
                  packingPercent: !Array.isArray(groupData) && groupData.packingPercent !== undefined ? Number(groupData.packingPercent) : Number(est.packingPercent || 0),
                  implementationPercent: !Array.isArray(groupData) && groupData.implementationPercent !== undefined ? Number(groupData.implementationPercent) : Number(est.implementationPercent || 0),
                  transportAmount: !Array.isArray(groupData) && groupData.transportAmount !== undefined ? Number(groupData.transportAmount) : 0,
                  transportDescription: !Array.isArray(groupData) && groupData.transportDescription ? String(groupData.transportDescription) : "Local Transportation",
                };
              }).filter(section => section.materialItems.length > 0 || section.serviceItems.length > 0)
            : [{
                srNo: 1,
                storeCode: targetStore?.storeCode || sortedItems.find(it => it.storeCode)?.storeCode || "",
                materialItems: sortedItems.filter(it => !isServiceItem(it)),
                serviceItems: sortedItems.filter(isServiceItem),
                packingPercent: Number(est.packingPercent || 0),
                implementationPercent: Number(est.implementationPercent || 0),
                transportAmount: Number(est.transportAmount || 0),
                transportDescription: "Local Transportation",
              }];

          return sectionDefs.flatMap(section => {
            const materialBase = section.materialItems.reduce((sum, item) => sum + Number(item.totalPrice || 0), 0);
            const rows = materialBase > 0 ? [{
              srNo: section.srNo,
              vendorCode: est.vendorCode || "",
              activityName: subject,
              storeCode: section.storeCode,
              qty: 1,
              beforeGst: materialBase,
              estimateNo: est.estimateNumber,
            }] : [];

            if (section.serviceItems.length > 0) {
              section.serviceItems.forEach(item => {
                rows.push({
                  srNo: section.srNo,
                  vendorCode: est.vendorCode || "",
                  activityName: serviceLabel(item),
                  storeCode: section.storeCode,
                  qty: 1,
                  beforeGst: Number(item.totalPrice || 0),
                  estimateNo: est.estimateNumber,
                });
              });
              return rows;
            }

            const syntheticServices = [
              { label: `Packing Charges (${section.packingPercent}%)`, amount: materialBase * (section.packingPercent / 100), show: section.packingPercent > 0 },
              { label: `Installation Charges (${section.implementationPercent}%)`, amount: materialBase * (section.implementationPercent / 100), show: section.implementationPercent > 0 },
              { label: section.transportDescription || "Local Transportation", amount: section.transportAmount, show: section.transportAmount > 0 },
            ];
            syntheticServices.forEach(service => {
              if (!service.show || service.amount <= 0) return;
              rows.push({
                srNo: section.srNo,
                vendorCode: est.vendorCode || "",
                activityName: service.label,
                storeCode: section.storeCode,
                qty: 1,
                beforeGst: service.amount,
                estimateNo: est.estimateNumber,
              });
            });
            return rows;
          });
        };

        const summaryNumber = (n: number) =>
          (Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        const copySummary = async () => {
          if (!selectedEstimate) return;
          const rows = buildSummaryRows(selectedEstimate, selectedEstimateItems || []);
          const headers = ["Sr No", "Vendor Code", "Element / Product Details", "Store Code", "Qty", "Before GST Net Price", "Estimate No"];
          const totalBeforeGst = rows.reduce((sum, row) => sum + row.beforeGst, 0);
          const escapeHtml = (value: any) => String(value ?? "").replace(/[&<>"']/g, ch => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            "\"": "&quot;",
            "'": "&#039;",
          }[ch] || ch));
          const htmlRows = rows.map(row => `
            <tr>
              <td style="border:1px solid #000;padding:6px 8px;text-align:center">${row.srNo}</td>
              <td style="border:1px solid #000;padding:6px 8px">${escapeHtml(row.vendorCode)}</td>
              <td style="border:1px solid #000;padding:6px 8px">${escapeHtml(row.activityName)}</td>
              <td style="border:1px solid #000;padding:6px 8px">${escapeHtml(row.storeCode)}</td>
              <td style="border:1px solid #000;padding:6px 8px;text-align:right">${summaryNumber(row.qty)}</td>
              <td style="border:1px solid #000;padding:6px 8px;text-align:right">${summaryNumber(row.beforeGst)}</td>
              <td style="border:1px solid #000;padding:6px 8px">${escapeHtml(row.estimateNo)}</td>
            </tr>`).join("");
          const html = `<table style="border-collapse:collapse;table-layout:fixed;width:100%;font-family:Arial,sans-serif;font-size:12px">
            <thead><tr>${headers.map(h => `<th style="border:1px solid #000;padding:6px 8px;background:#f1f5f9">${escapeHtml(h)}</th>`).join("")}</tr></thead>
            <tbody>${htmlRows}<tr><td colspan="5" style="border:1px solid #000;padding:6px 8px;text-align:right;font-weight:700">Total Before GST</td><td style="border:1px solid #000;padding:6px 8px;text-align:right;font-weight:700">₹ ${summaryNumber(totalBeforeGst)}</td><td style="border:1px solid #000;padding:6px 8px"></td></tr></tbody>
          </table>`;
          const tsvRows = [
            headers.join("\t"),
            ...rows.map(row => [row.srNo, row.vendorCode, row.activityName, row.storeCode, summaryNumber(row.qty), summaryNumber(row.beforeGst), row.estimateNo].join("\t")),
            ["", "", "", "", "Total Before GST", `₹ ${summaryNumber(totalBeforeGst)}`, ""].join("\t"),
          ].join("\n");

          try {
            if (navigator.clipboard && "ClipboardItem" in window) {
              await navigator.clipboard.write([
                new ClipboardItem({
                  "text/html": new Blob([html], { type: "text/html" }),
                  "text/plain": new Blob([tsvRows], { type: "text/plain" }),
                }),
              ]);
            } else {
              await navigator.clipboard.writeText(tsvRows);
            }
            setCopyStatus("Summary copied");
            window.setTimeout(() => setCopyStatus(""), 2500);
          } catch {
            setCopyStatus("Copy failed");
            window.setTimeout(() => setCopyStatus(""), 2500);
          }
        };

	        const handlePrintClick = (event: React.MouseEvent<HTMLButtonElement>) => {
	          event.preventDefault();
	          event.stopPropagation();
	          if (printCleanupRef.current) printCleanupRef.current();
	          applyPrintOptionClasses(printOptions);
	          // Override document.title so the browser's Save-as-PDF dialog
	          // suggests Estimate_<number>_<subject>.pdf instead of the app's
	          // tab title.
	          const previousTitle = document.title;
	          const safe = (value: string) => String(value)
	            .replace(/[\/\\:*?"<>|]+/g, "-")
	            .replace(/\s+/g, "-")
	            .replace(/-+/g, "-")
	            .replace(/^-|-$/g, "");
	          const numberPart = selectedEstimate?.estimateNumber ? safe(selectedEstimate.estimateNumber) : "";
	          const subjectPart = selectedEstimate?.title ? safe(selectedEstimate.title) : "";
	          const printTitle = [numberPart && `Estimate_${numberPart}`, subjectPart].filter(Boolean).join("_");
	          let restored = false;
	          const restoreTitle = () => {
	            if (restored) return;
	            // Only restore if the title is still our override — don't
	            // clobber a title some other code may have set in the meantime.
	            if (document.title === printTitle) document.title = previousTitle;
	            restored = true;
	          };
	          const cleanup = () => {
	            clearPrintOptionClasses();
	            restoreTitle();
	            window.removeEventListener("afterprint", cleanup);
	            window.removeEventListener("focus", focusRestore);
	            printCleanupRef.current = null;
	          };
	          // Safari sometimes doesn't fire afterprint reliably. When the
	          // print dialog closes, the window regains focus — use that as a
	          // fallback to guarantee document.title is restored.
	          const focusRestore = () => cleanup();
	          if (printTitle) document.title = printTitle;
	          printCleanupRef.current = cleanup;
	          window.addEventListener("afterprint", cleanup);
	          window.addEventListener("focus", focusRestore);
	          // Ensure the estimate document is rendered before printing.
	          // It is collapsed by default to keep the project dashboard fast;
	          // auto-expand it so the print captures real content, not a blank
	          // page. Delay print until React has committed the mount.
	          if (!showEstimateDocument) {
	            setShowEstimateDocument(true);
	            window.setTimeout(() => window.print(), 250);
	          } else {
	            window.setTimeout(() => window.print(), 50);
	          }
	        };

        const activeExecutionStats = executionStores.reduce((acc, row) => ({
          stores: acc.stores + 1,
          wcc: acc.wcc + (row.stats?.wccCount || 0),
          dc: acc.dc + (row.stats?.dcCount || 0),
          photos: acc.photos + (row.stats?.photoCount || 0),
          signedWcc: acc.signedWcc + (row.stats?.signedWccCount || 0),
          completed: acc.completed + (deriveStoreExecutionStage(row) === "Completed" ? 1 : 0),
          pending: acc.pending + (deriveStoreExecutionStage(row) === "Pending" ? 1 : 0),
        }), { stores: 0, wcc: 0, dc: 0, photos: 0, signedWcc: 0, completed: 0, pending: 0 });
        const fallbackWccCount = activeSelectedChallans.filter((dc: any) => isAblblFormat(dc.clientFormat)).length;
        const fallbackDcCount = activeSelectedChallans.filter((dc: any) => !isAblblFormat(dc.clientFormat)).length;
        const fallbackSignedWccCount = activeSelectedChallans.filter((dc: any) => dc.signedChallanPath).length;
        const fallbackPhotoCount = activeSelectedChallans.reduce((sum: number, dc: any) => sum + (Array.isArray(dc.metadata?.photos) ? dc.metadata.photos.length : (dc.photoPath ? 1 : 0)), 0);
        const dashboardStats = {
          stores: activeExecutionStats.stores || previewStoreCount,
          wcc: activeExecutionStats.wcc || fallbackWccCount,
          dc: activeExecutionStats.dc || fallbackDcCount,
          photos: activeExecutionStats.photos || fallbackPhotoCount,
          signedWcc: activeExecutionStats.signedWcc || fallbackSignedWccCount,
          completedStores: activeExecutionStats.completed,
          pendingStores: activeExecutionStats.pending || Math.max((activeExecutionStats.stores || previewStoreCount) - activeExecutionStats.completed, 0),
        };
        const fallbackGeneratedStoreCodes = new Set(activeSelectedChallans.map((dc: any) => String(dc.metadata?.storeCode || dc.storeCode || "").trim()).filter(Boolean));
        const fallbackSignedStoreCodes = new Set(activeSelectedChallans.filter((dc: any) => dc.signedChallanPath).map((dc: any) => String(dc.metadata?.storeCode || dc.storeCode || "").trim()).filter(Boolean));
        const fallbackPhotoStoreCodes = new Set(activeSelectedChallans.filter((dc: any) => dc.photoPath || (Array.isArray(dc.metadata?.photos) && dc.metadata.photos.length)).map((dc: any) => String(dc.metadata?.storeCode || dc.storeCode || "").trim()).filter(Boolean));
        const signedStoreCount = executionStores.length ? executionStores.filter(row => (row.stats?.signedWccCount || row.stats?.signedDcCount || 0) > 0).length : fallbackSignedStoreCodes.size;
        const generatedStoreCount = executionStores.length ? executionStores.filter(row => ((row.stats?.wccCount || 0) + (row.stats?.dcCount || 0)) > 0).length : fallbackGeneratedStoreCodes.size;
        const photoStoreCount = executionStores.length ? executionStores.filter(row => (row.stats?.photoCount || 0) > 0).length : fallbackPhotoStoreCodes.size;
        const dashboardProgress = dashboardStats.stores > 0 ? Math.round((signedStoreCount / dashboardStats.stores) * 100) : 0;
        const dashboardInvoices = selectedEstimate ? invoices.filter((inv: any) => inv.estimateId === selectedEstimate.id) : [];
        const hasDashboardPo = Boolean(selectedEstimate?.poNumber || selectedEstimate?.poFilePath);
        const allStoresHaveGeneratedDocs = dashboardStats.stores > 0 && generatedStoreCount >= dashboardStats.stores;
        const allStoresHaveSignedDocs = dashboardStats.stores > 0 && signedStoreCount >= dashboardStats.stores;
        const allStoresHavePhotos = dashboardStats.stores > 0 && photoStoreCount >= dashboardStats.stores;
        const executionComplete = dashboardStats.stores > 0 && executionStores.length > 0 && dashboardStats.completedStores >= dashboardStats.stores;
        const readinessChecks = [
          { key: "po", label: "PO Attached", done: hasDashboardPo },
          { key: "generated", label: "WCC Generated", done: allStoresHaveGeneratedDocs },
          { key: "signed", label: "Signed WCC Received", done: allStoresHaveSignedDocs },
          { key: "photos", label: "Photos Uploaded", done: allStoresHavePhotos },
          { key: "execution", label: "Execution Complete", done: executionComplete },
        ];
        const invoiceReady = readinessChecks.every(check => check.done);
        const projectTabs: Array<{ key: ProjectTab; label: string }> = [
          { key: "overview", label: "Overview" },
          { key: "po", label: "PO" },
          { key: "execution", label: "Execution" },
          { key: "documents", label: "Documents" },
          { key: "invoice", label: "Invoice" },
        ];
        const generatedInvoice = dashboardInvoices[0] || null;
        const handleGenerateProjectInvoice = async () => {
          if (!selectedEstimate || !token || generatingInvoice || !invoiceReady) return;
          if (generatedInvoice) {
            openInvoiceEditor && openInvoiceEditor({ invoiceId: generatedInvoice.id });
            return;
          }
          setGeneratingInvoice(true);
          try {
            const invoiceDate = new Date();
            const dueDate = new Date(Date.now() + 30 * 86400000);
            const lines = estimateItemsToInvoiceLines(previewItems);
            const amount = Number(selectedEstimate.subtotal || lines.reduce((sum, row) => sum + Number(row.amount || 0), 0));
            const taxAmount = Number(selectedEstimate.taxAmount || lines.reduce((sum, row) => sum + Number(row.taxAmount || 0), 0));
            const totalAmount = Number(selectedEstimate.totalAmount || amount + taxAmount);
            const primaryChallan = activeSelectedChallans[0] || null;
            const invoicePayload = {
              type: "sales",
              partyName: selectedEstimate.billingLegalNameSnapshot || selectedEstimate.billingTo || selectedEstimate.title || "Client",
              amount,
              taxAmount,
              totalAmount,
              date: invoiceDate.toISOString(),
              dueDate: dueDate.toISOString(),
              status: "draft",
              estimateId: selectedEstimate.id,
              clientId: selectedEstimate.clientId,
              paidAmount: 0,
              balanceAmount: totalAmount,
              packetSettings: {
                source: "project_dashboard",
                storeCount: dashboardStats.stores,
                generatedStoreCount,
                signedStoreCount,
                photoStoreCount,
                readinessChecks,
              },
              deliveryChallanId: primaryChallan?.id || null,
              lineItems: lines,
              poNumber: selectedEstimate.poNumber || null,
              poReference: selectedEstimate.poRemarks || null,
              remarks: `Generated from ${selectedEstimate.estimateNumber}`,
            };
            let created: any;
            if (isBoltMode) {
              created = await createInvoice(token, invoicePayload);
            } else {
              const numRes = await fetch("/api/numbering/invoice/next", {
                headers: { Authorization: `Bearer ${token}` },
              });
              if (!numRes.ok) throw new Error("Invoice number could not be generated");
              const { number } = await numRes.json();
              const res = await fetch("/api/finance/invoices", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({ invoiceNumber: number, ...invoicePayload }),
              });
              if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.message || "Invoice generation failed");
              }
              created = await res.json();
            }
            onInvoiceGenerated && await onInvoiceGenerated(created);
            openInvoiceEditor && openInvoiceEditor({ invoiceId: created.id });
          } catch (err: any) {
            alert(err.message || "Invoice generation failed");
          } finally {
            setGeneratingInvoice(false);
          }
        };
  return (
    <>
      {selectedEstimate && (
	        <div data-qa={isProjectWorkspace ? (isPageWorkspace ? "project-workspace-page" : "project-dashboard-modal") : "estimate-summary-modal"} className={isPageWorkspace ? "estimate-preview-modal project-workspace-page min-h-[calc(100vh-8rem)]" : "estimate-preview-modal fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-2 overflow-y-auto"}>
          <div className={isPageWorkspace ? "estimate-preview-panel bg-transparent w-full flex flex-col gap-4" : "estimate-preview-panel bg-white w-full max-w-[min(1280px,calc(100vw-16px))] rounded-lg shadow-2xl border border-slate-200 overflow-hidden max-h-[calc(100vh-16px)] flex flex-col"}>
            
            {/* Header */}
            <div className={`estimate-preview-chrome ${isPageWorkspace ? "bg-white border border-slate-200 rounded-lg text-slate-900 shadow-sm" : "bg-slate-900 text-white"} px-4 py-3 flex justify-between items-center`}>
              <div>
	                <span className={`text-[10px] font-black tracking-widest uppercase ${isPageWorkspace ? "text-orange-600" : "text-orange-400"}`}>{isProjectWorkspace ? "Project Workspace" : "Estimate Summary"}</span>
                <h3 className="text-xl font-bold flex items-center gap-2">
                  {selectedEstimate.title}
                  <span className={`text-xs py-0.5 px-3 rounded-full border ${isPageWorkspace ? "bg-slate-100 text-slate-600 border-slate-200" : "bg-slate-800 text-slate-300 border-slate-700"}`}>
                    {selectedEstimate.estimateNumber}
                  </span>
                </h3>
              </div>
              <button
                onClick={() => onBackToProjects ? onBackToProjects() : setSelectedEstimate(null)}
                className={`px-3 py-1.5 rounded-md border text-xs font-black transition ${isPageWorkspace ? "bg-white text-slate-600 border-slate-200 hover:bg-slate-50" : "border-transparent text-slate-400 hover:bg-slate-800 hover:text-white"}`}
              >
	                {isPageWorkspace ? "Back to Projects" : <X className="w-6 h-6" />}
              </button>
            </div>

            {/* Workflow Action Steps Panel */}
            <div className={`estimate-preview-chrome bg-slate-50 px-4 py-2 border border-slate-200 ${isPageWorkspace ? "rounded-lg" : "border-x-0 border-t-0"} flex flex-wrap gap-2 items-start justify-between`}>
	              {!isPageWorkspace && isProjectWorkspace && (
              <div className="flex flex-col gap-1">
                <div className="flex gap-1 items-center flex-wrap">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-wide mr-2">Workflow Status:</span>
                
                {/* Draft -> Sent */}
                {selectedEstimate.status === "draft" && (
                  <button 
                    onClick={() => handleUpdateStatus(selectedEstimate.id, "sent")}
                    className="py-1 px-3 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-lg transition"
                  >
                    Mark Quote as Sent
                  </button>
                )}

                {/* Sent -> Approved */}
                {selectedEstimate.status === "sent" && (
                  <div className="flex gap-1">
                    <button 
                      onClick={() => handleUpdateStatus(selectedEstimate.id, "approved")}
                      className="py-1 px-3 bg-green-600 hover:bg-green-500 text-white text-xs font-bold rounded-lg transition"
                    >
                      Approve Quote
                    </button>
                    <button 
                      onClick={() => handleUpdateStatus(selectedEstimate.id, "rejected")}
                      className="py-1 px-3 bg-red-600 hover:bg-red-500 text-white text-xs font-bold rounded-lg transition"
                    >
                      Reject Quote
                    </button>
                  </div>
                )}

                {/* Approved -> Awaiting PO */}
                {selectedEstimate.status === "approved" && (
                  <button 
                    onClick={() => handleUpdateStatus(selectedEstimate.id, "awaiting_po")}
                    className="py-1 px-3 bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold rounded-lg transition animate-pulse"
                  >
                    Set Awaiting PO
                  </button>
                )}

                {/* Awaiting PO -> PO Received (Modal trigger) */}
                {selectedEstimate.status === "awaiting_po" && !selectedEstimate.poNumber && (
                  <button 
                    onClick={() => {
                      if (openPoForEstimate) openPoForEstimate(selectedEstimate);
                      else {
                        setPoAmount(selectedEstimate.totalAmount.toString());
                        setShowPoModal(true);
                      }
                    }}
                    className="py-1 px-4 bg-orange-600 hover:bg-orange-500 text-white text-xs font-black rounded-lg transition shadow-md flex items-center gap-1"
                  >
                    <FileUp className="w-3.5 h-3.5" />
                    Attach & Upload Client PO
                  </button>
                )}

                {selectedEstimate.poNumber && (
                  <button
                    onClick={() => openPoForEstimate && openPoForEstimate(selectedEstimate)}
                    className="py-1 px-4 bg-green-700 hover:bg-green-600 text-white text-xs font-black rounded-lg transition shadow-md flex items-center gap-1"
                  >
                    <FileUp className="w-3.5 h-3.5" />
                    PO Received
                  </button>
                )}

                {/* PO Received -> Generate WCC / DC */}
                {selectedEstimate.status === "po_received" && (
                  <button
                    onClick={handleOpenDcModal}
                    className="py-1 px-4 bg-gradient-to-r from-orange-600 to-amber-500 hover:from-orange-500 hover:to-amber-400 text-white text-xs font-black rounded-lg transition shadow-md flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Generate {isAblblFormat(selectedEstimate.clientFormat) ? "WCC Certificate" : "Delivery Challan"}
                  </button>
                )}
                </div>
                <p className="text-[10px] text-slate-400 italic mt-0.5">
                  {selectedEstimate.status === "draft" && "Quote is in draft — click Mark as Sent once you've shared it with the client."}
                  {selectedEstimate.status === "sent" && "Waiting for client review — click Approve Quote once they confirm."}
                  {selectedEstimate.status === "approved" && "Quote approved — click Set Awaiting PO once you're expecting the purchase order."}
                  {selectedEstimate.status === "awaiting_po" && "Waiting for PO — click Attach & Upload Client PO once you receive it."}
                  {selectedEstimate.status === "po_received" && "PO confirmed — generate the Delivery Challan or WCC document to proceed."}
                  {selectedEstimate.status === "rejected" && "This quote was rejected. Create a new estimate or edit details as needed."}
                </p>
              </div>
              )}

              {/* Exports panel */}
              <div className={`flex gap-1 flex-wrap ${isPageWorkspace ? "w-full justify-end" : "justify-end"}`}>
	                {isProjectWorkspace && (
	                  <button
	                    type="button"
	                    onClick={() => setShowEstimateDocument(prev => !prev)}
	                    className={`py-1 px-3 border text-xs font-bold rounded-lg transition ${showEstimateDocument ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-700 border-slate-300 hover:bg-slate-100"}`}
	                  >
	                    {showEstimateDocument ? "Hide Estimate" : "View Estimate"}
	                  </button>
	                )}
	                {!isPageWorkspace && isProjectWorkspace && (
                  <button
                    type="button"
                    onClick={async () => {
                      if (isBoltMode) {
                        const client = clients.find((c: any) => c.id === selectedEstimate.clientId);
                        await exportEstimateToExcel(selectedEstimate, previewItems, client?.name, sellerProfile, stores);
                      } else {
                        window.open(`/api/operations/estimates/${selectedEstimate.id}/export-excel`, "_blank");
                      }
                    }}
                    className="inline-flex items-center gap-1.5 py-1 px-3 bg-green-50 border border-green-200 text-green-700 text-xs font-bold rounded-lg hover:bg-green-100 transition"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5" />
                    Detailed Excel
                  </button>
                )}
		                <button
		                  type="button"
		                  onClick={handlePrintClick}
		                  disabled={!detailItemsReady}
	                  className="inline-flex items-center gap-1.5 py-1 px-3 bg-slate-100 border border-slate-300 text-slate-700 text-xs font-bold rounded-lg hover:bg-slate-200 transition"
	                >
	                  <Printer className="w-3.5 h-3.5" />
		                  {!detailItemsReady ? "Loading Estimate..." : "Print Estimate"}
		                </button>
	                {!isProjectWorkspace && (
	                  <>
	                    <button
	                      type="button"
	                      onClick={handlePrintClick}
	                      disabled={!detailItemsReady}
	                      className="inline-flex items-center gap-1.5 py-1 px-3 bg-white border border-slate-300 text-slate-700 text-xs font-bold rounded-lg hover:bg-slate-100 transition disabled:opacity-50"
	                    >
	                      <Download className="w-3.5 h-3.5" />
	                      Print / Save as PDF
	                    </button>
	                    <button
	                      type="button"
	                      onClick={async () => {
	                        if (isBoltMode) {
	                          const client = clients.find((c: any) => c.id === selectedEstimate.clientId);
	                          await exportEstimateToExcel(selectedEstimate, previewItems, client?.name, sellerProfile, stores);
	                        } else {
	                          window.open(`/api/operations/estimates/${selectedEstimate.id}/export-excel`, "_blank");
	                        }
	                      }}
	                      className="inline-flex items-center gap-1.5 py-1 px-3 bg-green-50 border border-green-200 text-green-700 text-xs font-bold rounded-lg hover:bg-green-100 transition"
	                    >
	                      <FileSpreadsheet className="w-3.5 h-3.5" />
	                      Export to Excel
	                    </button>
	                    <button
	                      type="button"
	                      onClick={copySummary}
	                      className="inline-flex items-center gap-1.5 py-1 px-3 bg-white border border-slate-300 text-slate-700 text-xs font-bold rounded-lg hover:bg-slate-100 transition"
	                    >
	                      <Copy className="w-3.5 h-3.5" />
	                      Copy Summary
	                    </button>
	                  </>
	                )}
                {copyStatus && <span className="text-[10px] font-bold text-emerald-600 px-1 self-center">{copyStatus}</span>}
              </div>
            </div>

	            {isProjectWorkspace && <div className={`estimate-preview-chrome bg-white border border-slate-200 ${isPageWorkspace ? "rounded-lg" : "border-x-0 border-t-0"} px-4 py-2 flex items-center gap-2 overflow-x-auto`}>
	              {projectTabs.map(tab => (
	                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveProjectTab(tab.key)}
                  className={`px-3 py-1.5 rounded border text-xs font-black transition whitespace-nowrap ${activeProjectTab === tab.key ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`}
                >
                  {tab.label}
	                </button>
	              ))}
	            </div>}

            {/* Scrollable details view — single unified preview that matches
                the Excel/print template (no separate Estimate/Excel/export
                /Clean Data tabs). Same template, same data everywhere. */}
            <div className={isPageWorkspace ? "estimate-preview-scroll flex-1 space-y-4 print:p-0" : "estimate-preview-scroll flex-1 overflow-y-auto p-3 space-y-3 print:p-0"}>
	              {!isProjectWorkspace && (
	                <div className="space-y-3 print:p-0">
	                  <div className="estimate-preview-chrome grid grid-cols-2 lg:grid-cols-5 gap-2 text-xs">
	                    <div className="border border-slate-200 rounded p-2"><span className="block text-[10px] font-black uppercase text-slate-400">Estimate Date</span><b>{selectedEstimate.estimateDate ? formatShortDate(selectedEstimate.estimateDate) : formatShortDate(selectedEstimate.createdAt)}</b></div>
	                    <div className="border border-slate-200 rounded p-2"><span className="block text-[10px] font-black uppercase text-slate-400">Client</span><b>{clients.find(c => c.id === selectedEstimate.clientId)?.name || selectedEstimate.billingLegalNameSnapshot || selectedEstimate.billingTo || "Client"}</b></div>
	                    <div className="border border-slate-200 rounded p-2"><span className="block text-[10px] font-black uppercase text-slate-400">Brand</span><b>{brands.find(b => b.id === selectedEstimate.brandId)?.name || "Brand"}</b></div>
	                    <div className="border border-slate-200 rounded p-2"><span className="block text-[10px] font-black uppercase text-slate-400">PO Number</span><b>{selectedEstimate.poNumber || "Not received"}</b></div>
	                    <div className="border border-slate-200 rounded p-2"><span className="block text-[10px] font-black uppercase text-slate-400">Grand Total</span><b>{formatCurrency(selectedEstimate.totalAmount || 0)}</b></div>
	                  </div>
	                  <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm estimate-document-host">
	                    {selectedEstimateItemsLoading ? (
	                      <div className="p-6 text-xs font-bold text-slate-500">Loading estimate items...</div>
	                    ) : (
	                      <div data-print-document="true">
	                        <EstimateDocument
	                          estimate={selectedEstimate}
	                          items={selectedEstimateItems || []}
	                          stores={stores}
	                          clients={clients}
	                          products={products}
	                          brands={brands}
	                          sellerProfile={sellerProfile}
	                          assetToken={token}
	                        />
	                      </div>
	                    )}
	                  </div>
	                </div>
	              )}

	              {isProjectWorkspace && activeProjectTab === "overview" && (() => {
                // ── Command Center helpers ──────────────────────────────
                // Single-click upload → POST /api/operations/execution-documents
                // with the typed slot (wcc / signed_wcc / photo). On success,
                // refetch executionStores so counts/recent-activity refresh.
                const triggerExecDocUpload = (docType: "wcc" | "signed_wcc" | "photo") => {
                  const input = document.createElement("input");
                  input.type = "file";
                  input.accept = docType === "photo" ? "image/*,application/pdf" : "application/pdf,image/*";
                  input.multiple = docType === "photo";
                  input.onchange = async (ev) => {
                    const files = Array.from((ev.target as HTMLInputElement).files || []);
                    if (!files.length) return;
                    for (const file of files) {
                      try {
                        let filePath: string;
                        let fileName = file.name;

                        if (isBoltMode) {
                          const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
                          const storagePath = `estimate-${selectedEstimate.id}/${docType}/${Date.now()}-${safeName}`;
                          const { storagePath: saved } = await uploadToStorage("execution-documents", storagePath, file);
                          filePath = saved;
                        } else {
                          const fd = new FormData();
                          fd.append("file", file);
                          fd.append("documentType", docType);
                          fd.append("estimateId", String(selectedEstimate.id));
                          const res = await fetch("/api/operations/execution-documents", {
                            method: "POST",
                            headers: { Authorization: `Bearer ${token}` },
                            body: fd,
                          });
                          if (!res.ok) {
                            const body = await res.text().catch(() => "");
                            alert(`Upload failed (${res.status}). ${body || ""}`);
                            return;
                          }
                          continue;
                        }

                        await registerExecutionDocument(token, {
                          estimateId: selectedEstimate.id,
                          storeCode: "",
                          documentType: docType,
                          filePath,
                          originalFileName: fileName,
                          mimeType: file.type || null,
                          fileSize: file.size || null,
                          uploadedVia: "project_workspace",
                        });
                      } catch (err: any) {
                        alert(`Upload failed: ${err?.message || err}`);
                        return;
                      }
                    }
                    // Refresh by reloading the estimate context (parent owns fetch).
                    if (onInvoiceGenerated) await onInvoiceGenerated();
                  };
                  input.click();
                };
                const goToTab = (tab: ProjectTab, typeFilter?: string) => {
                  if (typeFilter) {
                    setDocumentTypeFilter(typeFilter);
                    if (!openDocSections.includes(typeFilter)) setOpenDocSections(prev => [...prev, typeFilter]);
                  }
                  setActiveProjectTab(tab);
                };
                // Recent activity rows with a click-target so each item navigates
                // to the right thing (open viewer for execution docs, switch to
                // the right tab for challans).
                const activityRows = [
                  ...executionStores.flatMap(row => (row.documents || []).map((doc: ExecutionDocumentRow) => ({
                    kind: "exec" as const,
                    label: `${labelForDocumentType(doc.documentType)} ${fileNameForDoc(doc) || ""}`.trim(),
                    type: labelForDocumentType(doc.documentType),
                    meta: row.storeCode,
                    date: doc.uploadedAt || doc.createdAt,
                    doc,
                  }))),
                  ...activeSelectedChallans.map((dc: any) => ({
                    kind: "challan" as const,
                    label: `${isAblblFormat(dc.clientFormat) ? "WCC" : "DC"} ${dc.dcNumber} ${dc.signedChallanPath ? "(signed)" : ""}`.trim(),
                    type: isAblblFormat(dc.clientFormat) ? "WCC" : "Delivery Challan",
                    meta: dc.metadata?.storeCode || "Project",
                    date: dc.createdAt || dc.deliveryDate,
                    challan: dc,
                  })),
                  generatedInvoice ? {
                    kind: "invoice" as const,
                    label: `Invoice ${generatedInvoice.invoiceNumber || "draft"} ${generatedInvoice.status || ""}`.trim(),
                    type: "Invoice",
                    meta: "Project",
                    date: generatedInvoice.updatedAt || generatedInvoice.createdAt,
                    invoice: generatedInvoice,
                  } : null,
                ].filter(Boolean) as any[];
                activityRows.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
                const activityHandle = (row: any) => {
                  if (row.kind === "exec") {
                    openExecutionDocumentViewer && openExecutionDocumentViewer(row.doc);
                  } else if (row.kind === "challan") {
                    openDcPreview && openDcPreview(row.challan);
                  } else if (row.kind === "invoice") {
                    openInvoiceEditor && openInvoiceEditor(row.invoice);
                  }
                };
                // Pending actions list with embedded handlers.
                const pendingActions = [
                  !hasDashboardPo ? {
                    label: "Attach client PO",
                    detail: "PO not received",
                    actionLabel: "Upload",
                    onAction: () => openPoForEstimate && openPoForEstimate(selectedEstimate),
                    Icon: FileUp,
                  } : null,
                  (!executionStoresLoading && generatedStoreCount < dashboardStats.stores) ? {
                    label: "Generate WCC for pending stores",
                    detail: `${dashboardStats.stores - generatedStoreCount} store${dashboardStats.stores - generatedStoreCount === 1 ? "" : "s"} pending`,
                    actionLabel: "Generate",
                    onAction: () => handleOpenDcModal && handleOpenDcModal(),
                    Icon: FilePlus,
                  } : null,
                  (!executionStoresLoading && signedStoreCount < dashboardStats.stores) ? {
                    label: "Collect signed WCC",
                    detail: `${dashboardStats.stores - signedStoreCount} store${dashboardStats.stores - signedStoreCount === 1 ? "" : "s"} pending`,
                    actionLabel: "Upload",
                    onAction: () => triggerExecDocUpload("signed_wcc"),
                    Icon: ScanLine,
                  } : null,
                  (!executionStoresLoading && photoStoreCount < dashboardStats.stores) ? {
                    label: "Upload execution photos",
                    detail: `${dashboardStats.stores - photoStoreCount} store${dashboardStats.stores - photoStoreCount === 1 ? "" : "s"} pending`,
                    actionLabel: "Upload",
                    onAction: () => triggerExecDocUpload("photo"),
                    Icon: Camera,
                  } : null,
                  !generatedInvoice ? {
                    label: "Generate invoice",
                    detail: invoiceReady ? "All checks complete" : "Pending readiness checks",
                    actionLabel: "Generate",
                    onAction: () => openInvoiceEditor && openInvoiceEditor(null),
                    Icon: FileText,
                  } : null,
                  (executionStores.length > 0 && executionStores.some(s => !(s.stats?.wccCount || s.stats?.dcCount))) ? {
                    label: "View missing documents",
                    detail: "See all pending documents",
                    actionLabel: "View",
                    onAction: () => goToTab("documents"),
                    Icon: AlertTriangle,
                  } : null,
                ].filter(Boolean) as Array<{ label: string; detail: string; actionLabel: string; onAction: () => void; Icon: any }>;
                // Project completion = signed/total (the strictest signal).
                const completionPct = dashboardProgress;
                const docCounts = {
                  wcc: executionStores.reduce((s, r) => s + (r.stats?.wccCount || 0), 0) || dashboardStats.wcc,
                  signedWcc: executionStores.reduce((s, r) => s + (r.stats?.signedWccCount || 0) + (r.stats?.signedDcCount || 0), 0) || dashboardStats.signedWcc,
                  photoSets: photoStoreCount,
                  other: 0,
                };
                const cardBase = "estimate-preview-chrome bg-white border border-slate-200 rounded-lg p-4 shadow-sm transition";
                const qaBtn = "inline-flex items-center justify-center gap-2 px-3 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-bold rounded-lg transition";
                return (
                <>
                  {/* QUICK ACTIONS BAR ─────────────────────────────────── */}
                  <section className={`${cardBase}`}>
                    <h4 className="text-[11px] font-black uppercase tracking-wider text-slate-500 mb-3">Quick Actions</h4>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                      <button type="button" onClick={() => { setShowEstimateDocument(true); window.requestAnimationFrame(() => document.querySelector('.estimate-document-host')?.scrollIntoView({ behavior: "smooth" })); }} className={qaBtn}>
                        <FileText className="w-3.5 h-3.5 text-blue-600" /> View Estimate
                      </button>
                      <button type="button" onClick={handlePrintClick} className={qaBtn}>
                        <Printer className="w-3.5 h-3.5 text-slate-600" /> Print Estimate
                      </button>
                      <button type="button" onClick={() => triggerExecDocUpload("wcc")} className={qaBtn}>
                        <Upload className="w-3.5 h-3.5 text-emerald-600" /> Upload WCC
                      </button>
                      <button type="button" onClick={() => triggerExecDocUpload("signed_wcc")} className={qaBtn}>
                        <Upload className="w-3.5 h-3.5 text-emerald-700" /> Upload Signed WCC
                      </button>
                      <button type="button" onClick={() => triggerExecDocUpload("photo")} className={qaBtn}>
                        <Camera className="w-3.5 h-3.5 text-orange-600" /> Upload Photos
                      </button>
                      <button type="button" onClick={() => openInvoiceEditor && openInvoiceEditor(generatedInvoice)} className={qaBtn}>
                        <FileText className="w-3.5 h-3.5 text-purple-600" /> {generatedInvoice ? "View Invoice" : "Generate Invoice"}
                      </button>
                    </div>
                  </section>

                  {/* PROJECT HEALTH SUMMARY ────────────────────────────── */}
                  <section className={cardBase}>
                    <h4 className="text-[11px] font-black uppercase tracking-wider text-slate-500 mb-3">Project Health Summary</h4>
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
                      {/* Donut */}
                      <div className="lg:col-span-2 flex justify-center">
                        <div className="relative w-24 h-24">
                          <svg viewBox="0 0 36 36" className="w-24 h-24 -rotate-90">
                            <circle cx="18" cy="18" r="15.9155" fill="none" stroke="#e2e8f0" strokeWidth="3" />
                            <circle cx="18" cy="18" r="15.9155" fill="none" stroke="#f59e0b" strokeWidth="3" strokeDasharray={`${completionPct} ${100 - completionPct}`} strokeLinecap="round" />
                          </svg>
                          <div className="absolute inset-0 flex flex-col items-center justify-center">
                            <span className="text-lg font-black text-slate-900">{completionPct}%</span>
                            <span className="text-[9px] uppercase text-slate-400 font-bold">Complete</span>
                          </div>
                        </div>
                      </div>
                      {/* Stores */}
                      <div className="lg:col-span-4">
                        <span className="block text-[10px] font-black uppercase text-slate-400 mb-1">Stores</span>
                        <div className="grid grid-cols-4 gap-2 text-xs">
                          <div><b className="block text-lg text-slate-900">{dashboardStats.stores}</b><span className="text-[10px] text-slate-500 font-semibold">Total</span></div>
                          <div><b className="block text-lg text-amber-600">{Math.max(0, dashboardStats.stores - generatedStoreCount)}</b><span className="text-[10px] text-amber-700 font-semibold">WCC Pending</span></div>
                          <div><b className="block text-lg text-blue-600">{Math.max(0, dashboardStats.stores - signedStoreCount)}</b><span className="text-[10px] text-blue-700 font-semibold">Signed Pending</span></div>
                          <div><b className="block text-lg text-orange-600">{Math.max(0, dashboardStats.stores - photoStoreCount)}</b><span className="text-[10px] text-orange-700 font-semibold">Photos Pending</span></div>
                        </div>
                      </div>
                      {/* Documents */}
                      <div className="lg:col-span-4">
                        <span className="block text-[10px] font-black uppercase text-slate-400 mb-1">Documents</span>
                        <div className="grid grid-cols-4 gap-2 text-xs">
                          <div><b className="block text-lg text-slate-900">{docCounts.wcc}</b><span className="text-[10px] text-slate-500 font-semibold">WCC</span></div>
                          <div><b className="block text-lg text-slate-900">{docCounts.signedWcc}</b><span className="text-[10px] text-slate-500 font-semibold">Signed WCC</span></div>
                          <div><b className="block text-lg text-slate-900">{docCounts.photoSets}</b><span className="text-[10px] text-slate-500 font-semibold">Photo Set</span></div>
                          <div><b className="block text-lg text-slate-900">{docCounts.other}</b><span className="text-[10px] text-slate-500 font-semibold">Other</span></div>
                        </div>
                      </div>
                      {/* Invoice */}
                      <div className="lg:col-span-2 border-l border-slate-100 pl-4">
                        <span className="block text-[10px] font-black uppercase text-slate-400 mb-1">Invoice</span>
                        <b className={`block text-base capitalize ${generatedInvoice ? "text-blue-700" : "text-slate-500"}`}>{generatedInvoice ? String(generatedInvoice.status || "draft").replace(/_/g, " ") : "Not Generated"}</b>
                        <span className="block text-[10px] text-slate-400 font-semibold">Invoice Status</span>
                        <button type="button" onClick={() => openInvoiceEditor && openInvoiceEditor(generatedInvoice)} className="mt-2 inline-flex items-center justify-center w-full py-1 border border-blue-200 text-blue-700 text-[10px] font-bold rounded hover:bg-blue-50">
                          {generatedInvoice ? "View Invoice" : "Generate Invoice"}
                        </button>
                      </div>
                    </div>
                  </section>

                  {/* 5 ACTIONABLE STATUS CARDS ─────────────────────────── */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                    {/* PO STATUS */}
                    <section className={cardBase}>
                      <div className="flex items-center justify-between text-[10px] font-black uppercase text-slate-400">
                        <span className="inline-flex items-center gap-1"><FileText className="w-3.5 h-3.5 text-slate-500" /> PO Status</span>
                        <ChevronRight className="w-3.5 h-3.5 text-slate-300" />
                      </div>
                      <div className={`mt-2 text-base font-black ${hasDashboardPo ? "text-emerald-700" : "text-amber-700"}`}>{hasDashboardPo ? "Received" : "Pending"}</div>
                      <span className="block text-[10px] text-slate-400 font-semibold">{hasDashboardPo ? `PO ${selectedEstimate.poNumber || ""}` : "PO not received"}</span>
                      <div className="mt-4">
                        {hasDashboardPo ? (
                          <button type="button" onClick={() => goToTab("po")} className="w-full inline-flex items-center justify-center py-1.5 border border-slate-200 text-slate-700 text-[11px] font-bold rounded hover:bg-slate-50">View PO</button>
                        ) : (
                          <button type="button" onClick={() => openPoForEstimate && openPoForEstimate(selectedEstimate)} className="w-full inline-flex items-center justify-center py-1.5 bg-purple-50 border border-purple-200 text-purple-700 text-[11px] font-bold rounded hover:bg-purple-100">Upload PO</button>
                        )}
                      </div>
                    </section>
                    {/* WCC PROGRESS */}
                    <section className={cardBase}>
                      <div className="flex items-center justify-between text-[10px] font-black uppercase text-slate-400">
                        <span className="inline-flex items-center gap-1"><FileText className="w-3.5 h-3.5 text-blue-500" /> WCC Progress</span>
                        <button type="button" onClick={() => goToTab("documents", "WCC")} className="text-slate-300 hover:text-slate-700"><ChevronRight className="w-3.5 h-3.5" /></button>
                      </div>
                      <div className="mt-2 text-base font-black text-slate-900">{generatedStoreCount} / {dashboardStats.stores}</div>
                      <span className="block text-[10px] text-slate-400 font-semibold">Stores Completed</span>
                      <div className="mt-2 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                        <div className="h-full bg-blue-500" style={{ width: `${dashboardStats.stores ? Math.round((generatedStoreCount / dashboardStats.stores) * 100) : 0}%` }} />
                      </div>
                      <div className="mt-3 grid grid-cols-3 gap-1">
                        <button type="button" onClick={() => goToTab("documents", "WCC")} className="py-1 border border-slate-200 text-slate-700 text-[10px] font-bold rounded hover:bg-slate-50">View All</button>
                        <button type="button" onClick={() => handleOpenDcModal && handleOpenDcModal()} className="py-1 border border-slate-200 text-slate-700 text-[10px] font-bold rounded hover:bg-slate-50">Generate</button>
                        <button type="button" onClick={() => triggerExecDocUpload("wcc")} className="py-1 border border-slate-200 text-slate-700 text-[10px] font-bold rounded hover:bg-slate-50">Upload</button>
                      </div>
                    </section>
                    {/* SIGNED WCC */}
                    <section className={cardBase}>
                      <div className="flex items-center justify-between text-[10px] font-black uppercase text-slate-400">
                        <span className="inline-flex items-center gap-1"><Pen className="w-3.5 h-3.5 text-emerald-500" /> Signed WCC Progress</span>
                        <button type="button" onClick={() => goToTab("documents", "Signed WCC")} className="text-slate-300 hover:text-slate-700"><ChevronRight className="w-3.5 h-3.5" /></button>
                      </div>
                      <div className="mt-2 text-base font-black text-slate-900">{signedStoreCount} / {dashboardStats.stores}</div>
                      <span className="block text-[10px] text-slate-400 font-semibold">Stores Completed</span>
                      <div className="mt-2 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                        <div className="h-full bg-emerald-500" style={{ width: `${dashboardStats.stores ? Math.round((signedStoreCount / dashboardStats.stores) * 100) : 0}%` }} />
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-1">
                        <button type="button" onClick={() => goToTab("documents", "Signed WCC")} className="py-1 border border-slate-200 text-slate-700 text-[10px] font-bold rounded hover:bg-slate-50">View All</button>
                        <button type="button" onClick={() => triggerExecDocUpload("signed_wcc")} className="py-1 border border-slate-200 text-slate-700 text-[10px] font-bold rounded hover:bg-slate-50">Upload</button>
                      </div>
                    </section>
                    {/* PHOTOS */}
                    <section className={cardBase}>
                      <div className="flex items-center justify-between text-[10px] font-black uppercase text-slate-400">
                        <span className="inline-flex items-center gap-1"><Camera className="w-3.5 h-3.5 text-orange-500" /> Photos Progress</span>
                        <button type="button" onClick={() => goToTab("documents", "Photos")} className="text-slate-300 hover:text-slate-700"><ChevronRight className="w-3.5 h-3.5" /></button>
                      </div>
                      <div className="mt-2 text-base font-black text-slate-900">{photoStoreCount} / {dashboardStats.stores}</div>
                      <span className="block text-[10px] text-slate-400 font-semibold">Stores Completed</span>
                      <div className="mt-2 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                        <div className="h-full bg-orange-500" style={{ width: `${dashboardStats.stores ? Math.round((photoStoreCount / dashboardStats.stores) * 100) : 0}%` }} />
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-1">
                        <button type="button" onClick={() => goToTab("documents", "Photos")} className="py-1 border border-slate-200 text-slate-700 text-[10px] font-bold rounded hover:bg-slate-50">View All</button>
                        <button type="button" onClick={() => triggerExecDocUpload("photo")} className="py-1 border border-slate-200 text-slate-700 text-[10px] font-bold rounded hover:bg-slate-50">Upload</button>
                      </div>
                    </section>
                    {/* INVOICE STATUS */}
                    <section className={cardBase}>
                      <div className="flex items-center justify-between text-[10px] font-black uppercase text-slate-400">
                        <span className="inline-flex items-center gap-1"><FileText className="w-3.5 h-3.5 text-purple-500" /> Invoice Status</span>
                        <button type="button" onClick={() => goToTab("invoice")} className="text-slate-300 hover:text-slate-700"><ChevronRight className="w-3.5 h-3.5" /></button>
                      </div>
                      <div className={`mt-2 text-base font-black capitalize ${generatedInvoice ? "text-blue-700" : "text-slate-500"}`}>{generatedInvoice ? String(generatedInvoice.status || "draft").replace(/_/g, " ") : "Not Generated"}</div>
                      <span className="block text-[10px] text-slate-400 font-semibold">Current Status</span>
                      <div className="mt-4">
                        <button type="button" onClick={() => openInvoiceEditor && openInvoiceEditor(generatedInvoice)} className="w-full inline-flex items-center justify-center py-1.5 bg-purple-50 border border-purple-200 text-purple-700 text-[11px] font-bold rounded hover:bg-purple-100">{generatedInvoice ? "View Invoice" : "Generate Invoice"}</button>
                      </div>
                    </section>
                  </div>

                  {/* RECENT ACTIVITY + PENDING ACTIONS ─────────────────── */}
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                    <section className={cardBase}>
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="text-[11px] font-black uppercase tracking-wider text-slate-500">Recent Activity</h4>
                        <button type="button" onClick={() => goToTab("documents")} className="text-[10px] font-bold text-blue-600 hover:text-blue-800">View All Activity</button>
                      </div>
                      <div className="space-y-1 text-xs">
                        {activityRows.length === 0 && <p className="text-slate-400 px-2 py-3">No project activity yet.</p>}
                        {activityRows.slice(0, 6).map((row, index) => {
                          const Icon = row.kind === "exec"
                            ? (row.type === "Photo" ? Camera : (row.type === "Signed WCC" || row.type === "Signed DC" ? Pen : FileText))
                            : row.kind === "invoice" ? FileText : FileText;
                          return (
                            <button
                              type="button"
                              key={`${row.kind}-${index}`}
                              onClick={() => activityHandle(row)}
                              className="w-full text-left flex items-center justify-between gap-3 px-2 py-2 rounded hover:bg-slate-50 border border-transparent hover:border-slate-200 transition"
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <span className="w-7 h-7 rounded bg-slate-100 inline-flex items-center justify-center text-slate-600 flex-shrink-0"><Icon className="w-3.5 h-3.5" /></span>
                                <div className="min-w-0">
                                  <b className="block text-slate-800 truncate">{row.label}</b>
                                  <span className="block text-[10px] text-slate-400">{row.type} · {row.meta}</span>
                                </div>
                              </div>
                              <span className="font-mono text-[10px] text-slate-500 flex-shrink-0">{formatShortDate(row.date)}</span>
                            </button>
                          );
                        })}
                      </div>
                    </section>
                    <section className={cardBase}>
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="text-[11px] font-black uppercase tracking-wider text-slate-500">Pending Actions</h4>
                        <button type="button" onClick={() => goToTab("documents")} className="text-[10px] font-bold text-blue-600 hover:text-blue-800">View All</button>
                      </div>
                      <div className="space-y-2 text-xs">
                        {pendingActions.length === 0 && (
                          <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 font-bold text-emerald-800">No pending project actions</div>
                        )}
                        {pendingActions.map((action) => {
                          const Icon = action.Icon;
                          return (
                            <div key={action.label} className="flex items-center justify-between gap-3 px-3 py-2 rounded border border-amber-200 bg-amber-50">
                              <div className="flex items-center gap-3 min-w-0">
                                <span className="w-7 h-7 rounded bg-white inline-flex items-center justify-center text-amber-700 flex-shrink-0 border border-amber-200"><Icon className="w-3.5 h-3.5" /></span>
                                <div className="min-w-0">
                                  <b className="block text-amber-900 truncate">{action.label}</b>
                                  <span className="block text-[10px] text-amber-700">{action.detail}</span>
                                </div>
                              </div>
                              <button type="button" onClick={action.onAction} className="flex-shrink-0 py-1 px-3 bg-white border border-amber-300 text-amber-800 text-[10px] font-bold rounded hover:bg-amber-100">
                                {action.actionLabel}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  </div>
                  {showEstimateDocument && (() => {
                    return (
                      <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm estimate-document-host">
                        <div className="estimate-preview-chrome flex items-center justify-between gap-3 mb-3">
                          <h4 className="text-xs font-black uppercase tracking-wider text-slate-700">Estimate View</h4>
                          <button type="button" onClick={() => setShowEstimateDocument(false)} className="px-2 py-1 rounded border border-slate-200 text-[10px] font-black text-slate-500 hover:bg-slate-50">Hide</button>
                        </div>
                        {selectedEstimateItemsLoading ? (
                          <div className="p-6 text-xs font-bold text-slate-500">Loading estimate items...</div>
                        ) : (
                          <EstimateDocument
                            estimate={selectedEstimate}
                            items={selectedEstimateItems || []}
                            stores={stores}
                            clients={clients}
                            products={products}
                            brands={brands}
                            sellerProfile={sellerProfile}
                            assetToken={token}
                          />
                        )}
                      </div>
                    );
                  })()}
                </>
                );
              })()}

              {isProjectWorkspace && activeProjectTab === "po" && selectedEstimate.poNumber && (() => {
                const fileName = selectedEstimate.poFilePath ? selectedEstimate.poFilePath.split("/").pop() : "";
                return (
                  <div className="estimate-preview-chrome border border-green-200 bg-green-50/20 p-4 rounded-xl text-xs space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                      <div>
                        <span className="text-[10px] font-black text-green-700 uppercase tracking-widest block">PO Received</span>
                        <h5 className="font-bold text-slate-800">PO Number: {selectedEstimate.poNumber}</h5>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 mt-2 text-slate-600">
                          <p><span className="font-bold text-slate-500">Upload Date:</span> {selectedEstimate.poDate ? new Date(selectedEstimate.poDate).toLocaleDateString("en-GB") : "Not captured"}</p>
                          <p><span className="font-bold text-slate-500">Uploaded By:</span> Not captured</p>
                          <p><span className="font-bold text-slate-500">File Name:</span> {fileName || "No file attached"}</p>
                          <p><span className="font-bold text-slate-500">Amount:</span> {formatCurrency(selectedEstimate.poAmount || 0)}</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {selectedEstimate.poFilePath && (
                          <>
                            <button type="button" onClick={() => openExecutionDocument(selectedEstimate.poFilePath!, false, selectedEstimate.id, true).catch(() => alert("Purchase Order not found"))} className="py-1.5 px-3 bg-white border border-green-200 text-green-700 rounded-lg font-bold hover:bg-green-50 transition">View PO</button>
                            <button type="button" onClick={() => openExecutionDocument(selectedEstimate.poFilePath!, true, selectedEstimate.id, true).catch(() => alert("Purchase Order not found"))} className="py-1.5 px-3 bg-white border border-green-200 text-green-700 rounded-lg font-bold hover:bg-green-50 transition">Download PO</button>
                          </>
                        )}
                        <button type="button" onClick={() => openPoForEstimate && openPoForEstimate(selectedEstimate)} className="py-1.5 px-3 bg-green-700 border border-green-700 text-white rounded-lg font-bold hover:bg-green-600 transition">Replace PO</button>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {isProjectWorkspace && activeProjectTab === "po" && !selectedEstimate.poNumber && (
                <div className="estimate-preview-chrome border border-dashed border-slate-200 bg-slate-50/50 p-4 rounded-xl text-xs flex items-center gap-3">
                  <FileUp className="w-5 h-5 text-slate-300 shrink-0" />
                  <div>
                    <p className="font-bold text-slate-500">PO Missing</p>
                    <p className="text-slate-400 mt-0.5">
                      {selectedEstimate.status === "awaiting_po"
                        ? "Upload the client PO against this estimate."
                        : "Set status to Awaiting PO when you're expecting the client's purchase order."}
                    </p>
                    <button type="button" onClick={() => openPoForEstimate && openPoForEstimate(selectedEstimate)} className="mt-2 py-1.5 px-3 bg-orange-600 hover:bg-orange-500 text-white text-[10px] font-black rounded-lg transition">Upload PO</button>
                  </div>
                </div>
              )}

              {isProjectWorkspace && activeProjectTab === "execution" && !selectedExecutionStore && <div className="estimate-preview-chrome border border-slate-200 bg-white p-4 rounded-xl text-xs space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h4 className="font-black text-slate-800 uppercase tracking-wider flex items-center gap-2">
                      <StoreIcon className="w-4 h-4 text-orange-600" />
                      Execution
                    </h4>
                    <p className="text-slate-500 mt-1">Store execution workspace for post-PO activity under {selectedEstimate.estimateNumber}.</p>
                  </div>
	                  <div className="flex flex-wrap gap-2 text-[10px] font-black uppercase tracking-wider">
	                    <span className="px-2 py-1 rounded border border-slate-200 bg-slate-50 text-slate-600">Stores {executionStores.length || previewStoreCount}</span>
	                    <span className="px-2 py-1 rounded border border-blue-200 bg-blue-50 text-blue-700">WCC {executionStores.reduce((sum, row) => sum + (row.stats?.wccCount || 0), 0)}</span>
	                    <span className="px-2 py-1 rounded border border-emerald-200 bg-emerald-50 text-emerald-700">Signed {executionStores.reduce((sum, row) => sum + (row.stats?.signedWccCount || 0), 0)}</span>
	                  </div>
	                </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
                    <div className="border border-slate-200 rounded p-3 bg-slate-50"><span className="block text-slate-400 font-black uppercase">Stores</span><b>{dashboardStats.stores}</b></div>
                    <div className="border border-emerald-200 rounded p-3 bg-emerald-50"><span className="block text-emerald-600 font-black uppercase">Completed</span><b>{dashboardStats.completedStores}</b></div>
                    <div className="border border-slate-200 rounded p-3 bg-white"><span className="block text-slate-400 font-black uppercase">Pending</span><b>{dashboardStats.pendingStores}</b></div>
                    <div className="border border-blue-200 rounded p-3 bg-blue-50"><span className="block text-blue-600 font-black uppercase">WCC Generated</span><b>{generatedStoreCount}/{dashboardStats.stores}</b></div>
                    <div className="border border-emerald-200 rounded p-3 bg-emerald-50"><span className="block text-emerald-600 font-black uppercase">Signed WCC Received</span><b>{signedStoreCount}/{dashboardStats.stores}</b></div>
                    <div className="border border-orange-200 rounded p-3 bg-orange-50"><span className="block text-orange-600 font-black uppercase">Photos Uploaded</span><b>{photoStoreCount}/{dashboardStats.stores}</b></div>
                  </div>

	                {executionStoresLoading ? (
                  <div className="border border-dashed border-slate-200 rounded-lg p-4 text-slate-400 font-semibold">Loading execution stores...</div>
                ) : executionStores.length ? (
                  <div className="overflow-x-auto border border-slate-100 rounded-lg">
                    <table className="w-full min-w-[1120px] text-left">
                      <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
                        <tr>
                          <th className="px-3 py-2 font-black">Store Code</th>
                          <th className="px-3 py-2 font-black">Store Name</th>
                          <th className="px-3 py-2 font-black text-center">Photos</th>
                          <th className="px-3 py-2 font-black">WCC Status</th>
                          <th className="px-3 py-2 font-black">Signed WCC Status</th>
                          <th className="px-3 py-2 font-black">Last Activity</th>
                          <th className="px-3 py-2 font-black">Last Updated</th>
                          <th className="px-3 py-2 font-black">Execution Status</th>
                          <th className="px-3 py-2 font-black text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {executionStores.map(row => {
                          const primaryWcc = findPrimaryWcc(row);
                          const stage = deriveStoreExecutionStage(row);
                          const lastActivity = latestActivityForStore(row);
                          const lastUpdated = latestTimestampForStore(row);
                          return (
                          <tr key={row.id} className="align-top hover:bg-orange-50/30 transition">
                            <td className="px-3 py-1.5">
                              <div className="font-mono font-black text-slate-800">{row.storeCode}</div>
                              {(row.storeCity || row.storeLocation || row.storeState) && (
                                <div className="text-[10px] text-slate-400">{[row.storeLocation, row.storeCity, row.storeState].filter(Boolean).join(", ")}</div>
                              )}
                            </td>
                            <td className="px-3 py-1.5">
                              <div className="font-bold text-slate-700">{row.storeName || "Store"}</div>
                              <div className="text-[10px] text-slate-400">{row.source ? executionStatusLabel(row.source) : selectedEstimate.estimateNumber}</div>
                            </td>
                            <td className="px-3 py-1.5 text-center">
                              <span className={(row.stats?.photoCount || 0) > 0 ? "font-black text-orange-700" : "font-black text-slate-400"}>{row.stats?.photoCount || 0}</span>
                            </td>
                            <td className="px-3 py-1.5">
                              <span className={(row.stats?.wccCount || row.stats?.dcCount) ? "font-black text-blue-700" : "font-black text-slate-400"}>
                                {(row.stats?.wccCount || row.stats?.dcCount) ? `${row.stats?.wccCount || row.stats?.dcCount} Generated` : "Pending"}
                              </span>
                              {primaryWcc && <div className="font-mono text-[10px] text-slate-500 mt-0.5">{primaryWcc.dcNumber}</div>}
                            </td>
                            <td className="px-3 py-1.5">
                              <span className={row.stats?.signedWccCount ? "font-black text-emerald-700" : "font-black text-slate-400"}>
                                {row.stats?.signedWccCount ? "Received" : "Pending"}
                              </span>
                            </td>
                            <td className="px-3 py-1.5">
                              <div className="font-semibold text-slate-700">{lastActivity?.label || "No activity"}</div>
                              <div className="text-[10px] text-slate-400">{formatShortDate(lastActivity?.date)}</div>
                            </td>
                            <td className="px-3 py-1.5 font-mono text-[10px] text-slate-500">{formatShortDateTime(lastUpdated)}</td>
                            <td className="px-3 py-1.5">
                              <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full border text-[10px] font-black uppercase ${executionStageClass(stage)}`}>
                                <CheckCircle2 className="w-3 h-3" />
                                {stage}
                              </span>
                            </td>
                            <td className="px-3 py-1.5">
                              <div className="flex justify-end flex-wrap gap-1">
                                <button type="button" title="Open store" onClick={() => setSelectedExecutionStore(row)} className={iconButtonClass}><Eye className="w-3.5 h-3.5" /></button>
                                <button type="button" title="View WCC" disabled={!primaryWcc} onClick={() => primaryWcc && openDcPreview && openDcPreview(primaryWcc)} className={iconButtonClass}><FileText className="w-3.5 h-3.5" /></button>
                                <button type="button" title="Edit WCC" disabled={!primaryWcc} onClick={() => primaryWcc && openDcForEdit && openDcForEdit(primaryWcc)} className={iconButtonClass}><Edit3 className="w-3.5 h-3.5" /></button>
                                <button type="button" title="Print WCC" disabled={!primaryWcc} onClick={() => primaryWcc && printDc && printDc(primaryWcc)} className={iconButtonClass}><Printer className="w-3.5 h-3.5" /></button>
                                <label title="Upload Signed WCC" className={`${iconButtonClass} ${primaryWcc ? "cursor-pointer" : "cursor-not-allowed"}`}>
                                  <Paperclip className="w-3.5 h-3.5" />
                                  {primaryWcc && <input type="file" className="hidden" onChange={(e) => handleStoreSignedWccUpload(row, e)} />}
                                </label>
                                <label title="Upload Photos" className={`${iconButtonClass} ${primaryWcc ? "cursor-pointer" : "cursor-not-allowed"}`}>
                                  <Camera className="w-3.5 h-3.5" />
                                  {primaryWcc && <input type="file" accept="image/*" className="hidden" onChange={(e) => handleStorePhotoUpload(row, e)} />}
                                </label>
                              </div>
                            </td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="border border-dashed border-slate-200 rounded-lg p-4 text-slate-500">
                    No execution stores found for this estimate yet. Existing estimate store data remains unchanged.
                  </div>
                )}
              </div>}

              {isProjectWorkspace && activeProjectTab === "documents" && (() => {
                type ProjectDocumentRow = {
                  key: string;
                  group: string;
                  fileName: string;
                  store: string;
                  type: string;
                  version: number | string;
                  uploadedBy: string;
                  uploadedDate: string | null;
                  filePath?: string | null;
                  executionDoc?: ExecutionDocumentRow | null;
                  challan?: any;
                  canReplace?: boolean;
                  canDelete?: boolean;
                  canHistory?: boolean;
                };
                const executionDocs = executionStores.flatMap(row => (row.documents || []).map((doc: ExecutionDocumentRow) => ({
                  ...doc,
                  storeCode: doc.storeCode || row.storeCode,
                })));
                const docRows: ProjectDocumentRow[] = [
                  selectedEstimate.poFilePath ? {
                    key: `po-${selectedEstimate.id}`,
                    group: "PO",
                    fileName: selectedEstimate.poFilePath.split("/").pop() || selectedEstimate.poNumber || "Purchase Order",
                    store: "Project",
                    type: "PO",
                    version: 1,
                    uploadedBy: "ERP",
                    uploadedDate: selectedEstimate.poDate || selectedEstimate.createdAt,
                    filePath: selectedEstimate.poFilePath,
                    canReplace: true,
                  } : null,
                  ...executionDocs.map((doc: ExecutionDocumentRow) => ({
                    key: `execution-doc-${doc.id}`,
                    group: doc.documentType === "photo" ? "Photos"
                      : doc.documentType === "signed_wcc" || doc.documentType === "signed_dc" ? "Signed WCC"
                      : doc.documentType === "transport_receipt" ? "Transport"
                      : doc.documentType === "extra" ? "Extra"
                      : doc.documentType === "po" ? "PO"
                      : doc.documentType === "wcc" ? "WCC"
                      : labelForDocumentType(doc.documentType),
                    fileName: fileNameForDoc(doc),
                    store: doc.storeCode || "Project",
                    type: labelForDocumentType(doc.documentType),
                    version: doc.version || 1,
                    uploadedBy: doc.uploadedBy || doc.uploadedVia || "ERP",
                    uploadedDate: doc.uploadedAt || doc.createdAt,
                    filePath: doc.filePath,
                    executionDoc: doc,
                    canReplace: true,
                    canDelete: true,
                    canHistory: true,
                  })),
                  ...activeSelectedChallans.map((dc: any) => ({
                    key: `challan-${dc.id}`,
                    group: isAblblFormat(dc.clientFormat) ? "WCC" : "Delivery Challan",
                    fileName: dc.dcNumber || "Generated document",
                    store: dc.metadata?.storeCode || dc.storeCode || "No store",
                    type: isAblblFormat(dc.clientFormat) ? "WCC" : "Delivery Challan",
                    version: "-",
                    uploadedBy: "ERP",
                    uploadedDate: dc.createdAt,
                    challan: dc,
                  })),
                ].filter(Boolean) as ProjectDocumentRow[];
                const groupOrder = ["PO", "Photos", "WCC", "Signed WCC", "Transport", "Extra", "Delivery Challan"];
                const storeOptions = Array.from(new Set(docRows.map(row => row.store).filter(Boolean))).sort();
                const typeOptions = Array.from(new Set(docRows.map(row => row.group).filter(Boolean))).sort();
                const filteredRows = docRows.filter(row =>
                  (documentStoreFilter === "all" || row.store === documentStoreFilter) &&
                  (documentTypeFilter === "all" || row.group === documentTypeFilter)
                );
                const sections = groupOrder
                  .map(group => ({ group, rows: filteredRows.filter(row => row.group === group) }))
                  .filter(section => section.rows.length || ["PO", "Photos", "WCC", "Signed WCC", "Transport", "Extra"].includes(section.group));
                const totalDocumentCount = docRows.length;
                const documentCards = ["PO", "WCC", "Signed WCC", "Photos", "Transport", "Extra"].map(group => {
                  const allRows = docRows.filter(row => row.group === group);
                  const latest = allRows
                    .filter(row => row.uploadedDate)
                    .sort((a, b) => new Date(String(b.uploadedDate)).getTime() - new Date(String(a.uploadedDate)).getTime())[0] || allRows[0];
                  return { group, rows: allRows, latest };
                });
                const renderDocumentActions = (row: ProjectDocumentRow) => (
                  <div className="flex justify-end flex-wrap gap-1">
                    {row.executionDoc ? (
                      <button type="button" title="View" onClick={() => openExecutionDocumentViewer && openExecutionDocumentViewer(row.executionDoc)} className={iconButtonClass}><Eye className="w-3.5 h-3.5" /></button>
                    ) : row.challan ? (
                      <button type="button" title="View" onClick={() => openDcPreview && openDcPreview(row.challan)} className={iconButtonClass}><Eye className="w-3.5 h-3.5" /></button>
                    ) : row.filePath ? (
                      <a href={row.filePath} target="_blank" rel="noreferrer" title="View" className={iconButtonClass}><Eye className="w-3.5 h-3.5" /></a>
                    ) : null}
                    {row.filePath && <a href={row.filePath} download title="Download" className={iconButtonClass}><Download className="w-3.5 h-3.5" /></a>}
                    {row.executionDoc ? (
                      <>
                        <button type="button" title="Replace" onClick={() => openExecutionDocumentViewer && openExecutionDocumentViewer(row.executionDoc)} className={iconButtonClass}><Upload className="w-3.5 h-3.5" /></button>
                        <button type="button" title="History" onClick={() => openExecutionDocumentHistoryViewer ? openExecutionDocumentHistoryViewer(row.executionDoc) : openExecutionDocumentViewer && openExecutionDocumentViewer(row.executionDoc)} className={iconButtonClass}><Briefcase className="w-3.5 h-3.5" /></button>
                        <button
                          type="button"
                          title="Delete"
                          onClick={() => {
                            // Stage 1: user click fires
                            console.log("[doc-delete] click", { id: row.executionDoc?.id, type: row.executionDoc?.documentType, file: row.fileName });
                            if (!deleteExecutionDocument) {
                              console.error("[doc-delete] deleteExecutionDocument prop not wired — owner did not pass the handler. Cannot delete.");
                              return;
                            }
                            if (!row.executionDoc) {
                              console.error("[doc-delete] row.executionDoc is missing — aborting.");
                              return;
                            }
                            // Stage 2: hand off to owner. Owner runs window.confirm,
                            // fires DELETE /api/operations/execution-documents/:id,
                            // and calls fetchData() on success which refreshes the
                            // executionStores list — the deleted row disappears.
                            deleteExecutionDocument(row.executionDoc);
                          }}
                          className={iconButtonClass}
                        ><X className="w-3.5 h-3.5" /></button>
                      </>
                    ) : row.group === "PO" ? (
                      <button type="button" title="Replace PO" onClick={() => openPoForEstimate && openPoForEstimate(selectedEstimate)} className={iconButtonClass}><Upload className="w-3.5 h-3.5" /></button>
                    ) : row.challan ? (
                      <button type="button" title="Delete" onClick={() => deleteDeliveryChallan && deleteDeliveryChallan(row.challan)} className={iconButtonClass}><X className="w-3.5 h-3.5" /></button>
                    ) : null}
                  </div>
                );
                return (
                  <div className="estimate-preview-chrome border border-slate-200 bg-white p-4 rounded-xl text-xs space-y-3">
                    <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3">
                      <div>
                        <h4 className="font-black text-slate-800 uppercase tracking-wider">Project Documents</h4>
                        <p className="text-slate-500 mt-1">Single project file view from existing PO, WCC/DC, proof, transport, and extra document records.</p>
                      </div>
                      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
                        <label className="space-y-1">
                          <span className="block text-[10px] font-black uppercase text-slate-400">Store</span>
                          <select value={documentStoreFilter} onChange={(e) => setDocumentStoreFilter(e.target.value)} className="h-8 border border-slate-200 rounded px-2 bg-white text-xs font-bold text-slate-700">
                            <option value="all">All Stores</option>
                            {storeOptions.map(store => <option key={store} value={store}>{store}</option>)}
                          </select>
                        </label>
                        <label className="space-y-1">
                          <span className="block text-[10px] font-black uppercase text-slate-400">Document Type</span>
                          <select value={documentTypeFilter} onChange={(e) => setDocumentTypeFilter(e.target.value)} className="h-8 border border-slate-200 rounded px-2 bg-white text-xs font-bold text-slate-700">
                            <option value="all">All Types</option>
                            {typeOptions.map(type => <option key={type} value={type}>{type}</option>)}
                          </select>
                        </label>
                        <span className="h-8 inline-flex items-center px-2 rounded border border-slate-200 bg-slate-50 text-slate-600 font-black uppercase tracking-wider">{filteredRows.length}/{totalDocumentCount} files</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                      {documentCards.map(card => (
                        <button
                          key={`doc-card-${card.group}`}
                          type="button"
                          onClick={() => {
                            setDocumentTypeFilter(card.group);
                            if (!openDocSections.includes(card.group)) setOpenDocSections(prev => [...prev, card.group]);
                          }}
                          className="rounded-lg border border-slate-200 bg-slate-50/70 p-4 text-left hover:border-orange-200 hover:bg-orange-50/50 transition"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="inline-flex items-center gap-2 font-black text-slate-800">{documentIconForGroup(card.group)} {card.group === "Extra" ? "Other Documents" : card.group}</span>
                            <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-black text-slate-600">{card.rows.length}</span>
                          </div>
                          <p className="mt-3 text-slate-500">
                            {card.latest ? `Latest upload ${formatShortDate(card.latest.uploadedDate)}` : "No files yet"}
                          </p>
                          <span className="mt-2 inline-flex text-[10px] font-black uppercase tracking-wider text-orange-600">Open</span>
                        </button>
                      ))}
                    </div>
                    {sections.map(section => (
                      <div key={section.group} className="border border-slate-100 rounded-lg overflow-hidden">
                        <button type="button" onClick={() => toggleDocSection(section.group)} className="w-full flex items-center justify-between px-3 py-2 bg-slate-50 hover:bg-slate-100 transition text-left">
                          <span className="font-black text-slate-700 inline-flex items-center gap-2">{documentIconForGroup(section.group)} {section.group} ({section.rows.length})</span>
                          <span className="text-slate-400">{openDocSections.includes(section.group) ? "Hide" : "Show"}</span>
                        </button>
                        {openDocSections.includes(section.group) && (
                          section.rows.length ? (
                            <div className="overflow-x-auto">
                              <table className="w-full min-w-[900px] text-left">
                                <thead className="bg-white text-[10px] uppercase tracking-wider text-slate-400">
                                  <tr>
                                    <th className="px-3 py-2 font-black">File Name</th>
                                    <th className="px-3 py-2 font-black">Store</th>
                                    <th className="px-3 py-2 font-black">Type</th>
                                    <th className="px-3 py-2 font-black">Version</th>
                                    <th className="px-3 py-2 font-black">Uploaded By</th>
                                    <th className="px-3 py-2 font-black">Uploaded Date</th>
                                    <th className="px-3 py-2 font-black text-right">Actions</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                  {section.rows.map(row => (
                                    <tr key={row.key} className="hover:bg-slate-50">
                                      <td className="px-3 py-2 font-mono font-bold text-slate-800"><span className="inline-flex items-center gap-2">{documentIconForGroup(row.group)} {row.fileName}</span></td>
                                      <td className="px-3 py-2 text-slate-600">{row.store}</td>
                                      <td className="px-3 py-2 text-slate-600">{row.type}</td>
                                      <td className="px-3 py-2 font-black text-slate-700">v{row.version}</td>
                                      <td className="px-3 py-2 text-slate-600">{row.uploadedBy}</td>
                                      <td className="px-3 py-2 text-slate-500">{formatShortDate(row.uploadedDate)}</td>
                                      <td className="px-3 py-2">{renderDocumentActions(row)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <div className="p-3 text-slate-400">No {section.group.toLowerCase()} documents match the current filters.</div>
                          )
                        )}
                      </div>
                    ))}
                  </div>
                );
              })()}

              {isProjectWorkspace && activeProjectTab === "invoice" && (
                <div className="estimate-preview-chrome border border-slate-200 bg-white p-4 rounded-xl text-xs space-y-4">
                  <div className={`rounded-xl border p-5 ${invoiceReady ? "border-emerald-200 bg-emerald-50/70" : "border-amber-200 bg-amber-50/70"}`}>
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Final Project Stage</p>
                        <h4 className="mt-1 text-2xl font-black text-slate-900">Invoice Destination</h4>
                      <p className="text-slate-500 mt-1">
                        {selectedEstimate.estimateNumber} · {clients.find(c => c.id === selectedEstimate.clientId)?.name || selectedEstimate.billingLegalNameSnapshot || "Client"} · {brands.find(b => b.id === selectedEstimate.brandId)?.name || "Brand"}
                      </p>
                        <p className="text-slate-500 mt-2">PO {selectedEstimate.poNumber || "Missing"} · Execution {dashboardStats.completedStores}/{dashboardStats.stores} completed · Project value {formatCurrency(selectedEstimate.totalAmount || 0)}</p>
                      </div>
                      <div className="flex flex-col items-start lg:items-end gap-2">
                        <span className={`px-3 py-1.5 rounded-full border text-[10px] font-black uppercase ${invoiceReady ? "bg-white text-emerald-700 border-emerald-200" : "bg-white text-amber-700 border-amber-200"}`}>
                          Invoice Ready: {invoiceReady ? "YES" : "NO"}
                        </span>
                        <button
                          type="button"
                          disabled={!invoiceReady || generatingInvoice}
                          onClick={handleGenerateProjectInvoice}
                          className="px-4 py-2 bg-slate-900 disabled:bg-slate-200 disabled:text-slate-400 text-white text-xs font-black rounded-lg hover:bg-slate-800 transition"
                        >
                          {generatedInvoice ? "Open Generated Invoice" : generatingInvoice ? "Generating..." : "Generate Invoice"}
                        </button>
                        {generatedInvoice && <a href={`/invoice-packet?id=${generatedInvoice.id}`} target="_blank" rel="noreferrer" className="text-xs font-black text-blue-700 hover:underline">Print / View Invoice PDF</a>}
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
                    {readinessChecks.map(check => (
                      <div key={check.key} className={`border rounded p-3 ${check.done ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white"}`}>
                        <span className="block text-slate-500 font-black uppercase">{check.label}</span>
                        <b className={check.done ? "text-emerald-700" : "text-red-600"}>{check.done ? "Yes" : "No"}</b>
                      </div>
                    ))}
                  </div>
                  <div className="border border-slate-100 rounded-lg overflow-hidden">
                    <table className="w-full text-left">
                      <tbody className="divide-y divide-slate-100">
                        {readinessChecks.map(check => (
                          <tr key={`row-${check.key}`}>
                            <td className="px-3 py-2 font-bold text-slate-700">{check.label}</td>
                            <td className={`px-3 py-2 text-right font-black ${check.done ? "text-emerald-700" : "text-red-600"}`}>{check.done ? "✓" : "✕"}</td>
                          </tr>
                        ))}
                        <tr className={invoiceReady ? "bg-emerald-50" : "bg-amber-50"}>
                          <td className="px-3 py-2 font-black text-slate-900">Invoice Ready</td>
                          <td className={`px-3 py-2 text-right font-black ${invoiceReady ? "text-emerald-700" : "text-amber-700"}`}>{invoiceReady ? "YES" : "NO"}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                    <div className="border border-slate-200 rounded p-3"><span className="block text-slate-400 font-bold uppercase">Store Count</span><b>{dashboardStats.stores}</b></div>
                    <div className="border border-slate-200 rounded p-3"><span className="block text-slate-400 font-bold uppercase">Project Value</span><b>{formatCurrency(selectedEstimate.totalAmount || 0)}</b></div>
                    <div className="border border-slate-200 rounded p-3"><span className="block text-slate-400 font-bold uppercase">Invoice Amount</span><b>{formatCurrency(generatedInvoice?.totalAmount || selectedEstimate.totalAmount || 0)}</b></div>
                    <div className="border border-slate-200 rounded p-3"><span className="block text-slate-400 font-bold uppercase">WCC Generated</span><b>{generatedStoreCount}/{dashboardStats.stores}</b></div>
                    <div className="border border-slate-200 rounded p-3"><span className="block text-slate-400 font-bold uppercase">Signed WCC</span><b>{signedStoreCount}/{dashboardStats.stores}</b></div>
                  </div>
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                    <section className="border border-slate-100 rounded-lg overflow-hidden">
                      <div className="px-3 py-2 bg-slate-50 border-b border-slate-100 font-black uppercase tracking-wider text-slate-600">Invoice Summary</div>
                      {generatedInvoice ? (
                        <div className="divide-y divide-slate-100">
                          <div className="flex items-center justify-between gap-2 px-3 py-2"><span className="text-slate-500">Invoice PDF</span><a href={`/invoice-packet?id=${generatedInvoice.id}`} target="_blank" rel="noreferrer" className="font-mono font-black text-blue-700 hover:underline">{generatedInvoice.invoiceNumber}</a></div>
                          <div className="flex items-center justify-between gap-2 px-3 py-2"><span className="text-slate-500">Status</span><span className="font-black capitalize text-slate-700">{String(generatedInvoice.status || "draft").replace(/_/g, " ")}</span></div>
                          <div className="flex items-center justify-between gap-2 px-3 py-2"><span className="text-slate-500">Amount</span><span className="font-black text-slate-900">{formatCurrency(generatedInvoice.totalAmount || 0)}</span></div>
                          <div className="flex flex-wrap gap-2 px-3 py-2">
                            <button type="button" onClick={() => openInvoiceEditor && openInvoiceEditor({ invoiceId: generatedInvoice.id })} className="px-2 py-1 bg-blue-50 border border-blue-200 text-blue-700 font-black rounded hover:bg-blue-100">Open</button>
                            <a href={`/invoice-packet?id=${generatedInvoice.id}`} target="_blank" rel="noreferrer" className="px-2 py-1 bg-orange-50 border border-orange-200 text-orange-700 font-black rounded hover:bg-orange-100">Print Invoice</a>
                          </div>
                        </div>
                      ) : (
                        <div className="p-3 text-slate-500">
                          {invoiceReady ? "Ready to generate invoice from this project." : "Invoice generation is disabled until readiness is complete."}
                        </div>
                      )}
                    </section>
                    <section className="border border-slate-100 rounded-lg overflow-hidden">
                      <div className="px-3 py-2 bg-slate-50 border-b border-slate-100 font-black uppercase tracking-wider text-slate-600">Execution Summary</div>
                      <div className="grid grid-cols-2 gap-2 p-3">
                        <div><span className="block text-slate-400 font-bold uppercase">Completed</span><b>{dashboardStats.completedStores}/{dashboardStats.stores}</b></div>
                        <div><span className="block text-slate-400 font-bold uppercase">Photos</span><b>{photoStoreCount}/{dashboardStats.stores}</b></div>
                        <div><span className="block text-slate-400 font-bold uppercase">WCC</span><b>{generatedStoreCount}/{dashboardStats.stores}</b></div>
                        <div><span className="block text-slate-400 font-bold uppercase">Signed</span><b>{signedStoreCount}/{dashboardStats.stores}</b></div>
                      </div>
                    </section>
                  </div>
                  <section className="border border-slate-100 rounded-lg overflow-hidden">
                    <div className="px-3 py-2 bg-slate-50 border-b border-slate-100 font-black uppercase tracking-wider text-slate-600">Store Summary</div>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[760px] text-left">
                        <thead className="bg-white text-[10px] uppercase tracking-wider text-slate-400">
                          <tr>
                            <th className="px-3 py-2 font-black">Store</th>
                            <th className="px-3 py-2 font-black">Photos</th>
                            <th className="px-3 py-2 font-black">WCC</th>
                            <th className="px-3 py-2 font-black">Signed WCC</th>
                            <th className="px-3 py-2 font-black">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {executionStores.map(row => (
                            <tr key={`invoice-store-${row.id}`}>
                              <td className="px-3 py-2"><span className="font-mono font-black">{row.storeCode}</span><span className="ml-2 text-slate-500">{row.storeName || "Store"}</span></td>
                              <td className="px-3 py-2">{row.stats?.photoCount || 0}</td>
                              <td className="px-3 py-2">{(row.stats?.wccCount || 0) + (row.stats?.dcCount || 0)}</td>
                              <td className="px-3 py-2">{(row.stats?.signedWccCount || 0) + (row.stats?.signedDcCount || 0)}</td>
                              <td className="px-3 py-2"><span className={`inline-flex px-2 py-1 rounded-full border text-[10px] font-black uppercase ${executionStageClass(deriveStoreExecutionStage(row))}`}>{deriveStoreExecutionStage(row)}</span></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                  <section className="border border-slate-100 rounded-lg overflow-hidden">
                    <div className="px-3 py-2 bg-slate-50 border-b border-slate-100 font-black uppercase tracking-wider text-slate-600">Supporting Documents</div>
                    <div className="p-3 flex flex-wrap gap-2">
                      {selectedEstimate.poFilePath && <button type="button" onClick={() => openExecutionDocument(selectedEstimate.poFilePath!, false, selectedEstimate.id, true).catch(() => alert("Purchase Order not found"))} className="px-2 py-1 bg-purple-50 border border-purple-200 text-purple-700 font-black rounded hover:bg-purple-100">PO</button>}
                      {activeSelectedChallans.map((dc: any) => <button key={`inv-wcc-${dc.id}`} type="button" onClick={() => openDcPreview && openDcPreview(dc)} className="px-2 py-1 bg-blue-50 border border-blue-200 text-blue-700 font-black rounded hover:bg-blue-100">{isAblblFormat(dc.clientFormat) ? "WCC" : "DC"} {dc.dcNumber}</button>)}
                      {executionStores.flatMap(row => row.signedWccDocuments || []).map((doc: ExecutionDocumentRow) => <button key={`inv-signed-${doc.id}`} type="button" onClick={() => openExecutionDocumentViewer && openExecutionDocumentViewer(doc)} className="px-2 py-1 bg-emerald-50 border border-emerald-200 text-emerald-700 font-black rounded hover:bg-emerald-100">Signed WCC {doc.storeCode || ""}</button>)}
                      {executionStores.flatMap(row => row.photoDocuments || []).slice(0, 8).map((doc: ExecutionDocumentRow) => <button key={`inv-photo-${doc.id}`} type="button" onClick={() => openExecutionDocumentViewer && openExecutionDocumentViewer(doc)} className="px-2 py-1 bg-orange-50 border border-orange-200 text-orange-700 font-black rounded hover:bg-orange-100">Photo {doc.storeCode || ""}</button>)}
                      {generatedInvoice && <a href={`/invoice-packet?id=${generatedInvoice.id}`} target="_blank" rel="noreferrer" className="px-2 py-1 bg-slate-900 border border-slate-900 text-white font-black rounded hover:bg-slate-800">Invoice PDF</a>}
                      {!selectedEstimate.poFilePath && activeSelectedChallans.length === 0 && dashboardStats.photos === 0 && !generatedInvoice && <span className="text-slate-400">No supporting documents linked yet.</span>}
                    </div>
                  </section>
                </div>
              )}

              {isProjectWorkspace && activeProjectTab === "execution" && !selectedExecutionStore && activeSelectedChallans.length === 0 && (
                <div className="estimate-preview-chrome border border-dashed border-slate-200 bg-slate-50/50 p-4 rounded-xl text-xs flex items-center gap-3">
                  <Briefcase className="w-5 h-5 text-slate-300 shrink-0" />
                  <div>
                    <p className="font-bold text-slate-500">No Delivery Challan or WCC issued yet.</p>
                    <p className="text-slate-400 mt-0.5">
                      {selectedEstimate.status === "po_received"
                        ? `Use the "Generate ${isAblblFormat(selectedEstimate.clientFormat) ? "WCC Certificate" : "Delivery Challan"}" button above to create the document.`
                        : "A DC/WCC can be created once the estimate reaches PO Received status."}
                    </p>
                  </div>
                </div>
              )}

              {selectedExecutionStore && (() => {
                const storeRow = selectedExecutionStore;
                const primaryWcc = findPrimaryWcc(storeRow);
                const photos = storeRow.photoDocuments || [];
                const docs = storeRow.documents || [];
                const signedWcc = storeRow.signedWccDocuments || [];
                const dcRecords = storeRow.dcRecords || [];
                const activity = [
                  ...docs.map((doc: ExecutionDocumentRow) => ({
                    id: `doc-${doc.id}`,
                    label: `${labelForDocumentType(doc.documentType)} ${doc.status || "active"}`,
                    date: doc.uploadedAt || doc.createdAt,
                  })),
                  ...(storeRow.wccRecords || []).map((wcc: any) => ({
                    id: `wcc-${wcc.id}`,
                    label: `WCC ${wcc.dcNumber} generated`,
                    date: wcc.createdAt,
                  })),
                ].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
                return (
                  <div data-qa="store-details-page" data-estimate-internal-modal="true" className="estimate-preview-chrome border border-slate-200 bg-white rounded-xl overflow-hidden shadow-sm">
                    <div className="flex flex-col">
                      <div className="px-4 py-3 bg-slate-950 text-white flex items-start justify-between gap-3">
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-widest text-orange-300">Store Workspace</p>
                          <h3 className="text-lg font-black">{storeRow.storeCode} | {storeRow.storeName || "Store"}</h3>
                          <p className="text-xs text-slate-300 mt-1">{[storeRow.storeLocation, storeRow.storeCity, storeRow.storeState].filter(Boolean).join(", ") || selectedEstimate.estimateNumber}</p>
                        </div>
                        <button type="button" onClick={() => setSelectedExecutionStore(null)} className="px-3 py-1.5 text-xs font-black text-slate-200 border border-white/20 hover:bg-white/10 rounded">
                          Back to Execution
                        </button>
                      </div>
                      <div className="p-4 space-y-4 text-xs">
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                          <div className="border border-slate-200 rounded p-3"><span className="block text-slate-400 font-bold uppercase">Status</span><b>{executionStatusLabel(storeRow.status)}</b></div>
                          <div className="border border-slate-200 rounded p-3"><span className="block text-slate-400 font-bold uppercase">Photos</span><b>{storeRow.stats?.photoCount || 0}</b></div>
                          <div className="border border-slate-200 rounded p-3"><span className="block text-slate-400 font-bold uppercase">DC</span><b>{storeRow.stats?.dcCount || 0}</b></div>
                          <div className="border border-slate-200 rounded p-3"><span className="block text-slate-400 font-bold uppercase">WCC</span><b>{storeRow.stats?.wccCount || 0}</b></div>
                          <div className="border border-slate-200 rounded p-3"><span className="block text-slate-400 font-bold uppercase">Signed WCC</span><b>{storeRow.stats?.signedWccCount ? "Received" : "Pending"}</b></div>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_0.8fr] gap-4">
                          <section className="border border-slate-200 rounded-lg p-3 space-y-3 bg-white">
                            <div className="flex items-center justify-between gap-2">
                              <div>
                                <h4 className="font-black text-slate-800 uppercase tracking-wider">Photo Gallery</h4>
                                <p className="text-slate-400 mt-0.5">{photos.length} execution photo{photos.length === 1 ? "" : "s"}</p>
                              </div>
                              <label className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-[10px] font-black ${primaryWcc ? "cursor-pointer bg-white hover:bg-slate-50 border-slate-200 text-slate-700" : "bg-slate-50 border-slate-200 text-slate-400 cursor-not-allowed"}`}>
                                <Upload className="w-3 h-3" /> Upload Photos
                                {primaryWcc && <input type="file" accept="image/*" className="hidden" onChange={(e) => handleStorePhotoUpload(storeRow, e)} />}
                              </label>
                            </div>
                            {photos.length ? (
                              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                                {photos.slice(0, 9).map((doc: ExecutionDocumentRow, index) => (
                                  <button key={doc.id} type="button" onClick={() => { setSelectedExecutionStore(null); openExecutionDocumentViewer && openExecutionDocumentViewer(doc); }} className="group border border-slate-200 rounded-lg overflow-hidden bg-slate-50 text-left hover:border-orange-300 hover:shadow-sm transition">
                                    {isImageDoc(doc) && !brokenImageDocs[doc.id] ? (
                                      <img
                                        src={documentImageUrl(doc)}
                                        alt={`Store photo ${index + 1}`}
                                        className="w-full aspect-[4/3] object-cover bg-slate-100"
                                        loading="lazy"
                                        onError={() => setBrokenImageDocs(prev => ({ ...prev, [doc.id]: true }))}
                                      />
                                    ) : (
                                      <div className="aspect-[4/3] flex flex-col items-center justify-center gap-2 bg-slate-100 text-slate-400">
                                        <ImageIcon className="w-8 h-8" />
                                        <span className="text-[10px] font-black uppercase tracking-wider">Preview unavailable</span>
                                      </div>
                                    )}
                                    <span className="block p-2 text-[10px] font-black text-slate-700">Photo {index + 1}</span>
                                  </button>
                                ))}
                              </div>
                            ) : <p className="text-slate-400">No photos uploaded for this store.</p>}
                          </section>

                          <section className="border border-slate-200 rounded-lg p-3 space-y-3 bg-slate-50/50">
                            <h4 className="font-black text-slate-800 uppercase tracking-wider">WCC Summary</h4>
                            {primaryWcc ? (
                              <div className="space-y-2">
                                <div className="rounded-lg border border-slate-200 bg-white p-3">
                                  <span className="block text-[10px] uppercase tracking-wider text-slate-400 font-black">Current WCC</span>
                                  <b className="font-mono text-slate-900">{primaryWcc.dcNumber}</b>
                                  <span className="block mt-1 text-emerald-700 font-black">{primaryWcc.signedChallanPath || signedWcc.length ? "Signed received" : "Awaiting signature"}</span>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  <button type="button" title="View WCC" onClick={() => { setSelectedExecutionStore(null); openDcPreview && openDcPreview(primaryWcc); }} className={iconButtonClass}><Eye className="w-3.5 h-3.5" /></button>
                                  <button type="button" title="Edit WCC" onClick={() => { openDcForEdit && openDcForEdit(primaryWcc); window.setTimeout(() => setSelectedExecutionStore(null), 0); }} className={iconButtonClass}><Edit3 className="w-3.5 h-3.5" /></button>
                                  <button type="button" title="Print WCC" onClick={() => { printDc && printDc(primaryWcc); window.setTimeout(() => setSelectedExecutionStore(null), 0); }} className={iconButtonClass}><Printer className="w-3.5 h-3.5" /></button>
                                  <label title="Upload Signed WCC" className={`${iconButtonClass} cursor-pointer`}>
                                    <Paperclip className="w-3.5 h-3.5" />
                                    <input type="file" className="hidden" onChange={(e) => handleStoreSignedWccUpload(storeRow, e)} />
                                  </label>
                                </div>
                              </div>
                            ) : <p className="text-slate-400">No WCC generated for this store yet.</p>}

                            <div className="border-t border-slate-200 pt-3">
                              <h4 className="font-black text-slate-800 uppercase tracking-wider">Signed WCC</h4>
                              {signedWcc.length ? signedWcc.map((doc: ExecutionDocumentRow, index) => (
                                <button key={doc.id} type="button" onClick={() => { setSelectedExecutionStore(null); openExecutionDocumentViewer && openExecutionDocumentViewer(doc); }} className="mt-2 w-full flex items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-left hover:bg-emerald-100">
                                  <span><b className="block text-emerald-800">Signed proof {index + 1}</b><span className="text-emerald-700">{formatShortDate(doc.uploadedAt || doc.createdAt)}</span></span>
                                  <Eye className="w-4 h-4 text-emerald-700" />
                                </button>
                              )) : <p className="mt-2 text-slate-400">Signed WCC pending.</p>}
                            </div>

                            <div className="border-t border-slate-200 pt-3">
                              <h4 className="font-black text-slate-800 uppercase tracking-wider">Delivery Challan</h4>
                              {dcRecords.length ? dcRecords.map((dc: any) => <p key={dc.id} className="mt-1 font-mono font-black text-slate-700">{dc.dcNumber}</p>) : <p className="mt-1 text-slate-400">No DC record for this store.</p>}
                            </div>
                          </section>
                        </div>

                        <section className="border border-slate-200 rounded-lg p-3 space-y-2 bg-white">
                          <h4 className="font-black text-slate-800 uppercase tracking-wider">Document Summary</h4>
                          {docs.length ? (
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                              {docs.map((doc: ExecutionDocumentRow) => (
                                <button key={doc.id} type="button" onClick={() => { setSelectedExecutionStore(null); openExecutionDocumentViewer && openExecutionDocumentViewer(doc); }} className="border border-slate-100 rounded-lg p-3 text-left hover:border-orange-200 hover:bg-orange-50/40 transition">
                                  <span className="inline-flex items-center gap-2 font-black text-slate-800">{documentIconForGroup(doc.documentType === "photo" ? "Photos" : labelForDocumentType(doc.documentType))}{labelForDocumentType(doc.documentType)}</span>
                                  <span className="block mt-1 text-slate-400">v{doc.version || 1} · {formatShortDate(doc.uploadedAt || doc.createdAt)}</span>
                                </button>
                              ))}
                            </div>
                          ) : <p className="text-slate-400">No execution documents for this store.</p>}
                        </section>

                        <section className="border border-slate-200 rounded-lg p-3 space-y-2">
                          <h4 className="font-black text-slate-800 uppercase tracking-wider">Activity</h4>
                          {activity.length ? activity.slice(0, 8).map(item => (
                            <div key={item.id} className="flex items-center justify-between border-b border-slate-100 last:border-b-0 py-1">
                              <span className="font-semibold text-slate-700">{item.label}</span>
                              <span className="text-slate-400">{item.date ? new Date(item.date).toLocaleDateString("en-GB") : "—"}</span>
                            </div>
                          )) : <p className="text-slate-400">No activity yet.</p>}
                        </section>
                      </div>
                    </div>
                  </div>
                );
              })()}

            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default EstimatePreview;
