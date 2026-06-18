import React, { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "../../contexts/AuthContext";
import { useGlobalDate } from "../../contexts/GlobalDateContext";
import { formatCurrency } from "./utils/formatters";
import {
  calculateEstimateRowValues,
  calculateServiceChargeRowValues,
  formatServiceRateInput,
  isPercentageRateInput,
  isServiceLineType,
  parseRateInput,
} from "./utils/estimateCalculations";
import { blankRowForStore, validateExcelPasteRows } from "./utils/estimateFormatting";
import { orderedStoreKeysFromItems } from "./utils/estimateOrdering";
import { buildStoreGrouping } from "./utils/storeGrouping";
import { validateGstin, validatePan, validateEstimateItems, validateEstimateItemsBatch } from "../../../../shared/validation";
import { formatProductDetails, sameDisplayText } from "../../../../shared/productDetails";
import type {
  Client,
  Brand,
  Store,
  Product,
  Estimate,
  EstimateItem,
  DeliveryChallan,
  WccPhoto,
  MaterialCodeRow,
  EstimateItemInput,
  OpTab,
} from "./types";
import ClientsPanel from "./components/ClientsPanel";
import BrandsPanel from "./components/BrandsPanel";
import StoresPanel from "./components/StoresPanel";
import ProductsPanel from "./components/ProductsPanel";
import MasterDataImportExportPanel from "./components/MasterDataImportExportPanel";
import InvoiceLedgerPanel from "./components/InvoiceLedgerPanel";
import InvoiceEditor from "./components/InvoiceEditor";
import ProjectTrackerPanel from "./components/ProjectTrackerPanel";
import BillingProfilesDialog from "./components/BillingProfilesDialog";
import PoUploadModal from "./components/PoUploadModal";
import DeliveryChallanPanel from "./components/DeliveryChallanPanel";
import EstimateBuilder from "./components/EstimateBuilder";
import EstimatePreview from "./components/EstimatePreview";
import ProjectWorkspace from "./components/ProjectWorkspace";
import WccDcEditor from "./components/WccDcEditor";
import { useOperationsData, type Invoice } from "./hooks/useOperationsData";
import { isBoltMode } from "../../lib/supabase";
import { createEstimate, updateEstimate, createDeliveryChallan, updateDeliveryChallan, fetchEstimateItems, fetchDeliveryChallansForEstimate, fetchBillingProfiles as apiFetchBillingProfiles, fetchCompanySettings, createInvoice, createPayment, fetchClientLedger, masterDataSave } from "../../lib/api";
import { useEstimateBuilder } from "./hooks/useEstimateBuilder";
import { useInvoiceWorkflow } from "./hooks/useInvoiceWorkflow";
import { useWccDcEditor } from "./hooks/useWccDcEditor";
import { importFieldsMap } from "./utils/importFieldsMap";
import { displayFormatLabel, isAblblFormat, normalizeDisplayName, normalizeFormatMode, normalizeGstinPan } from "../../../../shared/textFormat";
import {
  Building2, 
  Tag, 
  MapPin, 
  Package, 
  FileText, 
  Plus, 
  CheckCircle, 
  Trash,
  ShoppingBag,
  Download,
  Upload,
  Eye,
  Check,
  X,
  FileSpreadsheet,
  Image as ImageIcon,
  FileUp,
  Printer,
  ChevronDown,
  ChevronRight,
  Scale,
  AlertCircle,
  Clock,
  Briefcase,
  Database,
  Copy,
  Truck,
  Receipt,
  Clipboard,
  ClipboardPaste,
  FolderOpen,
} from "lucide-react";

const MATERIAL_CODE_MASTER = [
  { code: "MC-ABF-001", name: "Frontlit Flex Signage (Standard)" },
  { code: "MC-ABF-002", name: "Backlit Flex Signage (Premium)" },
  { code: "MC-ABF-003", name: "Acrylic LED Letter (3D)" },
  { code: "MC-ABF-004", name: "PVC Foam Board (Sunboard)" },
  { code: "MC-ABF-005", name: "Vinyl Printing with Lamination" },
  { code: "MC-ABF-006", name: "Fabric Lightbox (LED)" },
  { code: "MC-ABF-007", name: "ACP Cladding (External)" },
  { code: "MC-ABF-008", name: "Clip-on Frame Poster" },
  { code: "MC-ABF-009", name: "MDF / Wooden Signboard" },
  { code: "MC-ABF-010", name: "Metal Framing / MS Work" }
];


const VALID_TABS: OpTab[] = ["clients","brands","stores","products","estimates","projects","challans","master_data","invoices_ledger","project_tracker"];
const MASTER_TABS: OpTab[] = ["clients", "brands", "stores", "products", "master_data"];
const MASTER_PAGE_TITLES: Partial<Record<OpTab, string>> = {
  clients: "Client Master",
  brands: "Brand Master",
  stores: "Store/Site Master",
  products: "Products & Rates",
  master_data: "Master Data Import / Export",
};

const getInitialTab = (override?: OpTab): OpTab => {
  if (override) return override;
  if (typeof window === "undefined") return "estimates";
  const hash = window.location.hash.replace(/^#/, "");
  if (VALID_TABS.includes(hash as OpTab)) return hash as OpTab;
  return "estimates";
};

const normalizeImportHeader = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");

const withStableEstimateOrder = (rows: EstimateItemInput[]): EstimateItemInput[] => {
  const storeOrder = new Map<string, number>();
  let nextStoreOrder = 1;
  let nextRowOrder = 1;

  rows.forEach((item) => {
    const storeKey = String(item.storeId || "__unassigned__");
    const existingStoreOrder = Number(item.storeSortOrder);
    if (!storeOrder.has(storeKey) && Number.isFinite(existingStoreOrder) && existingStoreOrder > 0) {
      storeOrder.set(storeKey, existingStoreOrder);
      nextStoreOrder = Math.max(nextStoreOrder, existingStoreOrder + 1);
    }
    const existingRowOrder = Number(item.rowSortOrder);
    if (Number.isFinite(existingRowOrder) && existingRowOrder > 0) {
      nextRowOrder = Math.max(nextRowOrder, existingRowOrder + 1);
    }
  });

  const assignedRowOrders = new Set<number>();
  return rows.map((item, index) => {
    const storeKey = String(item.storeId || "__unassigned__");
    if (!storeOrder.has(storeKey)) storeOrder.set(storeKey, nextStoreOrder++);

    let rowOrder = Number(item.rowSortOrder);
    if (!Number.isFinite(rowOrder) || rowOrder <= 0 || assignedRowOrders.has(rowOrder)) {
      while (assignedRowOrders.has(nextRowOrder)) nextRowOrder += 1;
      rowOrder = nextRowOrder++;
    }
    assignedRowOrders.add(rowOrder);

    return {
      ...item,
      sl: index + 1,
      storeSortOrder: storeOrder.get(storeKey) || 1,
      rowSortOrder: rowOrder,
    };
  });
};

interface OperationsPageProps {
  // When set, the page renders only the focused panel and hides the hub
  // header + top tab strip. Used by the Bolt-style dedicated routes
  // (/clients, /estimates, /delivery-challans, etc.).
  focusTab?: OpTab;
  focusTitle?: string;
  focusSubtitle?: string;
}

const OperationsPage: React.FC<OperationsPageProps> = ({ focusTab, focusTitle, focusSubtitle }) => {
  const { token, user } = useAuth();
  const globalDate = useGlobalDate();
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState<OpTab>(getInitialTab(focusTab));
  const [message, setMessage] = useState("");
  const {
    loading,
    clients,
    setClients,
    brands,
    stores,
    products,
    setProducts,
    materialCodes,
    estimates,
    setEstimates,
    challans,
    invoices,
    ledgerSummary,
    fetchLedgerData,
    fetchEstimates,
    fetchData,
  } = useOperationsData(token, globalDate.range);

  // Sync active tab with URL hash so sidebar deep links work — disabled in
  // focus mode where the URL path identifies the panel instead of a hash.
  useEffect(() => {
    if (focusTab) {
      setActiveTab(focusTab);
      return;
    }
    const onHash = () => {
      const hash = window.location.hash.replace(/^#/, "");
      if (VALID_TABS.includes(hash as OpTab)) setActiveTab(hash as OpTab);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [focusTab]);

  useEffect(() => {
    if (focusTab) return;
    if (typeof window !== "undefined") {
      const desired = `#${activeTab}`;
      if (window.location.hash !== desired) {
        history.replaceState(null, "", window.location.pathname + window.location.search + desired);
      }
    }
  }, [activeTab, focusTab]);

  // Invoices & Ledger UI State
  interface ClientStatementItem {
    date: string;
    ref: string;
    type: string;
    amount: number;
    debitAmount: number;
    creditAmount: number;
    balance: number;
    remarks: string | null;
  }

  const [activeLedgerClientId, setActiveLedgerClientId] = useState<number | null>(null);
  const [clientStatement, setClientStatement] = useState<ClientStatementItem[]>([]);
  const [statementLoading, setStatementLoading] = useState(false);
  const [invoiceSubTab, setInvoiceSubTab] = useState<"packets" | "ledger" | "clients">("packets");

  // Record Payment Dialog
  const [showRecordPayment, setShowRecordPayment] = useState(false);
  const [paymentClientId, setPaymentClientId] = useState<string>("");
  const [paymentAmount, setPaymentAmount] = useState<string>("");
  const [paymentMethod, setPaymentMethod] = useState<string>("bank_transfer");
  const [paymentDate, setPaymentDate] = useState<string>(new Date().toISOString().split("T")[0]);
  const [paymentRemarks, setPaymentRemarks] = useState<string>("");
  const [paymentAllocations, setPaymentAllocations] = useState<Record<number, number>>({});

  // Invoice Packet Builder Modal (legacy — replaced by InvoiceEditor below)
  const [showPacketBuilder, setShowPacketBuilder] = useState(false);
  const [selectedEstForPacket, setSelectedEstForPacket] = useState<Estimate | null>(null);
  const [invoiceNumberInput, setInvoiceNumberInput] = useState("");
  const [invoiceDateInput, setInvoiceDateInput] = useState(new Date().toISOString().split("T")[0]);
  const [invoiceDueDateInput, setInvoiceDueDateInput] = useState(
    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]
  );
  const [invoiceRemarksInput, setInvoiceRemarksInput] = useState("");
  const [selectedBillingProfileId, setSelectedBillingProfileId] = useState<number | null>(null);
  const [customShippingAddress, setCustomShippingAddress] = useState("");

  const {
    invoiceEditor,
    openInvoiceEditor,
    closeInvoiceEditor,
    cancelInvoice,
    deleteInvoice,
  } = useInvoiceWorkflow(token, fetchLedgerData);

  const [packetCheckedPages, setPacketCheckedPages] = useState<string[]>([
    "invoice",
    "quote",
    "wcc",
    "signed_dc",
    "photos",
    "receipts"
  ]);
  const [packetPageOrder, setPacketPageOrder] = useState<string[]>([
    "invoice",
    "quote",
    "wcc",
    "signed_dc",
    "photos",
    "receipts"
  ]);

  // Toggle Forms
  const [showClientForm, setShowClientForm] = useState(false);
  const [showBrandForm, setShowBrandForm] = useState(false);
  const [showStoreForm, setShowStoreForm] = useState(false);
  const [showProductForm, setShowProductForm] = useState(false);
  const [showEstimateForm, setShowEstimateForm] = useState(false);
  const fallbackEstimateNumber = () => {
    const now = new Date();
    const startYear = now.getMonth() < 3 ? now.getFullYear() - 1 : now.getFullYear();
    const fy = `${String(startYear).slice(-2)}-${String(startYear + 1).slice(-2)}`;
    const startAt = fy === "26-27" ? 201 : 101;
    return `SM/E/${fy}/${startAt}`;
  };
  // Auto-open the New Estimate form when the route carries ?new=1 (used by the
  // sidebar's "New Estimate" link in Sales & Estimates). Strips the param once
  // honored so reloading the page doesn't re-fire.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("new") === "1") {
      if (!isBoltMode) {
        void fetch(`/api/numbering/estimate/next`, { headers: { Authorization: `Bearer ${token}` } })
          .then(r => r.ok ? r.json() : null)
          .then(j => setEstNumber(j?.number || fallbackEstimateNumber()))
          .catch(() => setEstNumber(fallbackEstimateNumber()));
      } else {
        setEstNumber(fallbackEstimateNumber());
      }
      setEstDate(todayYmd);
      setEditingEstimateId(null);
      setShowEstimateForm(true);
      params.delete("new");
      const qs = params.toString();
      history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash);
    }
  }, [token]);

  // Warn before browser navigate/close when estimate form is open with data
  useEffect(() => {
    if (!showEstimateForm) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [showEstimateForm]);

  // Client Form
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [clientCity, setClientCity] = useState("");
  const [clientAddress, setClientAddress] = useState("");
  const [clientGst, setClientGst] = useState("");
  const [clientFormatSetting, setClientFormatSetting] = useState("normal");
  
  // Client Extended Fields
  const [clientGroupName, setClientGroupName] = useState("");
  const [clientType, setClientType] = useState("normal");
  const [clientPan, setClientPan] = useState("");
  const [clientPrimaryContact, setClientPrimaryContact] = useState("");
  const [clientPaymentTerms, setClientPaymentTerms] = useState("");
  const [clientVendorCodeField, setClientVendorCodeField] = useState("");

  // Brand Form
  const [brandName, setBrandName] = useState("");
  const [brandParent, setBrandParent] = useState("");

  // Store Form
  const [storeName, setStoreName] = useState("");
  const [storeClientId, setStoreClientId] = useState("");
  const [storeBrandId, setStoreBrandId] = useState("");
  const [storeLocation, setStoreLocation] = useState("");
  const [storeAddress, setStoreAddress] = useState("");
  const [storeContact, setStoreContact] = useState("");
  const [storePhone, setStorePhone] = useState("");
  
  // Store Extended Fields
  const [storeCode, setStoreCode] = useState("");
  const [storeCity, setStoreCity] = useState("");
  const [storeState, setStoreState] = useState("");
  const [storeStateCode, setStoreStateCode] = useState("");
  const [storeRegion, setStoreRegion] = useState("");
  const [storeAltContact, setStoreAltContact] = useState("");

  // Billing Profiles management states
  const [billingProfiles, setBillingProfiles] = useState<any[]>([]);
  const [showBillingProfileDialog, setShowBillingProfileDialog] = useState(false);
  const [selectedClientForProfiles, setSelectedClientForProfiles] = useState<Client | null>(null);
  
  // Billing Profile Form fields
  const [bpLegalName, setBpLegalName] = useState("");
  const [bpBranch, setBpBranch] = useState("");
  const [bpGstin, setBpGstin] = useState("");
  const [bpPan, setBpPan] = useState("");
  const [bpState, setBpState] = useState("");
  const [bpStateCode, setBpStateCode] = useState("");
  const [bpBillingAddress, setBpBillingAddress] = useState("");
  const [bpShippingAddress, setBpShippingAddress] = useState("");
  const [bpContactPerson, setBpContactPerson] = useState("");
  const [bpMobile, setBpMobile] = useState("");
  const [bpEmail, setBpEmail] = useState("");
  const [bpIsDefault, setBpIsDefault] = useState(false);
  const [bpIsActive, setBpIsActive] = useState(true);
  const [bpNotes, setBpNotes] = useState("");
  const [editingBpId, setEditingBpId] = useState<number | null>(null);
  const [showBpForm, setShowBpForm] = useState(false);

  // Estimate Form Billing Profile selector
  const [estBillingProfileId, setEstBillingProfileId] = useState("");
  const [clientBillingProfilesList, setClientBillingProfilesList] = useState<any[]>([]);

  // Master Importer states
  const [impType, setImpType] = useState("clients");
  const [impHeaders, setImpHeaders] = useState<string[]>([]);
  const [impPreviewRows, setImpPreviewRows] = useState<any[]>([]);
  const [impAllRows, setImpAllRows] = useState<any[]>([]);
  const [impMappings, setImpMappings] = useState<Record<string, string>>({});
  const [impStats, setImpStats] = useState<any>(null);
  const [impIsParsing, setImpIsParsing] = useState(false);
  const [impIsCommitting, setImpIsCommitting] = useState(false);
  const [impFileName, setImpFileName] = useState("");

  // Product Form
  const [prodName, setProdName] = useState("");
  const [prodCat, setProdCat] = useState("");
  const [prodUnit, setProdUnit] = useState("sqft");
  const [prodRate, setProdRate] = useState("");
  const [prodDesc, setProdDesc] = useState("");
  const [prodHsn, setProdHsn] = useState("");
  const [prodIsStandard, setProdIsStandard] = useState(true);
  const [prodCalcType, setProdCalcType] = useState("sqft");
  const [prodGst, setProdGst] = useState("18");
  const [prodSpecs, setProdSpecs] = useState("");
  const [prodWarranty, setProdWarranty] = useState("");
  const [prodMaterialCodeId, setProdMaterialCodeId] = useState<string>("");
  const [editingProductId, setEditingProductId] = useState<number | null>(null);

  // Estimate Form Header Fields
  const [estNumber, setEstNumber] = useState("");
  const [estTitle, setEstTitle] = useState("");
  const [estClientId, setEstClientId] = useState("");
  const [estBrandId, setEstBrandId] = useState("");
  const [estStoreId, setEstStoreId] = useState("");
  const [estDescription, setEstDescription] = useState("");
  const [estFormat, setEstFormat] = useState("normal");
  // ABFRL project type: SELEX (no material code required) | CAPEX (material code required per row).
  // Only relevant when estFormat is ABLBL. See ARCHITECTURE_NOTES.md.
  const [estAbfrlProjectType, setEstAbfrlProjectType] = useState<"SELEX" | "CAPEX">("SELEX");
  // Source/target stores for ABFRL multi-store row duplication.
  const [storeDupSource, setStoreDupSource] = useState("");
  const [storeDupTarget, setStoreDupTarget] = useState("");
  // Multi-row clipboard for "Copy rows → Paste below". The clipboard is
  // session-only (lives in state, not localStorage) so it survives navigation
  // within the form but not page reloads.
  const [rowClipboard, setRowClipboard] = useState<EstimateItemInput[] | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const dirtyEnabledRef = useRef(false);
  const [estSubject, setEstSubject] = useState("");
  const [estBillingTo, setEstBillingTo] = useState("");
  const [estShippingTo, setEstShippingTo] = useState("");
  const [estGstin, setEstGstin] = useState("");
  const [estPan, setEstPan] = useState("");
  const [estStateCode, setEstStateCode] = useState("");
  const [estVendorCode, setEstVendorCode] = useState("");
  const [estGstType, setEstGstType] = useState("CGST+SGST");
  const [estPacking, setEstPacking] = useState("4");
  const [estImplementation, setEstImplementation] = useState("7");
  const [estTransport, setEstTransport] = useState("0");
  // estDate: the document date the user picks (default today). Stored as
  // yyyy-mm-dd so the <input type="date"> binds cleanly. Sent as ISO string
  // to the server which coerces it into the estimate_date timestamp column.
  const todayYmd = new Date().toISOString().slice(0, 10);
  const [estDate, setEstDate] = useState<string>(todayYmd);
  // editingEstimateId is non-null when the user clicked Edit on an existing
  // row. Save flow then PATCHes /api/operations/estimates/:id with replaceItems
  // instead of POSTing a new estimate. Reset to null after save / cancel.
  const [editingEstimateId, setEditingEstimateId] = useState<number | null>(null);
  // Seller profile (Sunrise Media) — drives tax decisions & seller header.
  const [sellerProfile, setSellerProfile] = useState<{
    name: string;
    gstin: string;
    pan: string;
    state: string;
    stateCode: string;
    address: string;
    mobile?: string;
    email?: string;
    bankName?: string;
    bankAccountNumber?: string;
    bankIfsc?: string;
    bankBranch?: string;
    defaultGstPercent?: string;
    defaultPacking?: string;
    defaultImplementation?: string;
    defaultLocalTransport?: string;
    defaultOutstationTransportRate?: string;
    defaultEstimatePrefix?: string;
    defaultInvoicePrefix?: string;
    defaultDcPrefix?: string;
    logoPath?: string;
    signatureStampPath?: string;
    terms?: string;
  }>(
    {
      name: "Sunrise Media",
      gstin: "",
      pan: "",
      state: "Maharashtra",
      stateCode: "27",
      address: "",
      defaultGstPercent: "18",
      defaultPacking: "4",
      defaultImplementation: "7",
      defaultLocalTransport: "1000",
      defaultOutstationTransportRate: "18",
    }
  );

  // Per-store charge overrides keyed by storeId string. Each store can
  // carry its own packing %, installation %, transport amount and a
  // transport description (local / outstation / km). Empty / undefined
  // values fall back to the global estPacking / estImplementation / 0.
  type EstStoreOverride = {
    packingPercent?: string;
    implementationPercent?: string;
    transportType?: "local" | "outstation";
    transportAmount?: string;
    transportKm?: string;
    transportRate?: string;
    transportDescription?: string;
    storeName?: string;
    storeLocation?: string;
    storeCity?: string;
    storeState?: string;
    storeAddress?: string;
  };
  const [estStoreOverrides, setEstStoreOverrides] = useState<Record<string, EstStoreOverride>>({});

  // Grid Items Input — starts empty. The Excel-style builder requires the
  // user to click "Add Store" first, which seeds the first row with a
  // storeId. New rows are appended via the per-store "+ Row" button.
  const [estItems, setEstItems] = useState<EstimateItemInput[]>([]);

  // Unsaved-changes dirty tracking. Reset when form opens, enable after
  // initial hydration delay so loading items doesn't immediately mark dirty.
  useEffect(() => {
    dirtyEnabledRef.current = false;
    setIsDirty(false);
    setLastSavedAt(null);
    if (!showEstimateForm) return;
    const t = window.setTimeout(() => { dirtyEnabledRef.current = true; }, 500);
    return () => window.clearTimeout(t);
  }, [showEstimateForm, editingEstimateId]);

  useEffect(() => {
    if (dirtyEnabledRef.current) setIsDirty(true);
  }, [estItems]);

  // Excel paste modal — when open, holds the storeId that pasted rows attach
  // to and the raw TSV/CSV text the user pastes from Excel.
  const [pasteModalStoreId, setPasteModalStoreId] = useState<string | null>(null);
  const [pasteText, setPasteText] = useState<string>("");
  const [pasteError, setPasteError] = useState<string>("");
  const [pastePreviewRows, setPastePreviewRows] = useState<Array<Partial<EstimateItemInput>>>([]);

  const {
    calculatedSubtotal,
    calculatedTax,
    calculatedGrandTotal,
  } = useEstimateBuilder(estItems, estPacking, estImplementation, estTransport, estGstType);

  const setOrderedEstItems: React.Dispatch<React.SetStateAction<EstimateItemInput[]>> = (value) => {
    setEstItems(prev => {
      const next = typeof value === "function"
        ? (value as (prevState: EstimateItemInput[]) => EstimateItemInput[])(prev)
        : value;
      return recalculateEstimateRows(next, estGstType);
    });
  };

  const settingsPercentRate = (value: any) => {
    const raw = String(value ?? "").trim();
    if (!raw) return "";
    return raw.includes("%") ? raw : `${raw}%`;
  };

  const serviceChargeLabel = (baseLabel: string, rateInput: any) => {
    const rateValue = parseRateInput(rateInput);
    return rateValue > 0 ? `${baseLabel} (${rateValue}%)` : baseLabel;
  };

  const outstationTransportLabel = (rateInput: any) => {
    const rateValue = parseRateInput(rateInput);
    return rateValue > 0 ? `Outstation Transportation (₹${rateValue}/KM)` : "Outstation Transportation";
  };

  const recalculateEstimateRows = (rows: EstimateItemInput[], gstTypeValue = estGstType): EstimateItemInput[] => {
    const defaultGstPct = Number(sellerProfile.defaultGstPercent) || 18;
    const productRowsCalculated = rows.map(row => {
      if (isServiceLineType(row.lineType)) return { ...row };
      const selectedProd = products.find(p => p.id === Number(row.productId));
      const gstPct = selectedProd ? selectedProd.gstPercent : defaultGstPct;
      const calc = calculateEstimateRowValues(
        row.calculationType,
        Number(row.width) || 0,
        Number(row.height) || 0,
        Number(row.quantity) || 0,
        Number(row.rate) || 0,
        gstPct,
        gstTypeValue,
      );
      return { ...row, ...calc };
    });

    const materialBaseByStore = productRowsCalculated.reduce<Record<string, number>>((acc, row) => {
      if (isServiceLineType(row.lineType)) return acc;
      const sid = String(row.storeId || "");
      if (!sid) return acc;
      acc[sid] = (acc[sid] || 0) + (Number(row.amount) || 0);
      return acc;
    }, {});

    const recalculated = productRowsCalculated.map(row => {
      if (!isServiceLineType(row.lineType)) return row;
      const materialCode = materialCodes.find(m => m.id === row.materialCodeId || m.code === row.materialCode);
      const gstPct = materialCode?.gstPercent || defaultGstPct;
      const calc = row.lineType === "transport" && row.unit === "km"
        ? calculateEstimateRowValues(
          "fixed",
          0,
          0,
          Number(row.quantity) || 0,
          Number(row.rate) || 0,
          gstPct,
          gstTypeValue,
        )
        : calculateServiceChargeRowValues(
          row.rate,
          materialBaseByStore[String(row.storeId || "")] || 0,
          gstPct,
          gstTypeValue,
        );
      return {
        ...row,
        calculationType: isPercentageRateInput(row.rate) ? "percentage" : "fixed",
        ...calc,
      };
    });
    return withStableEstimateOrder(recalculated);
  };

  // Load seller (Sunrise Media) profile once. Used for the seller block on
  // the document AND to auto-derive CGST+SGST vs IGST whenever the billing
  // state code changes. Failing silently is fine — defaults stay.
  useEffect(() => {
    if (!token) return;
    (isBoltMode ? fetchCompanySettings(token) : fetch("/api/company-settings", { headers: { Authorization: `Bearer ${token}` } }).then(r => r.ok ? r.json() : null))
      .then(j => {
        if (!j) return;
        setSellerProfile(j);
        if (j.defaultPacking !== undefined && j.defaultPacking !== null) setEstPacking(String(j.defaultPacking));
        if (j.defaultImplementation !== undefined && j.defaultImplementation !== null) setEstImplementation(String(j.defaultImplementation));
        if (j.defaultLocalTransport !== undefined && j.defaultLocalTransport !== null) setEstTransport(String(j.defaultLocalTransport));
      })
      .catch(() => {});
  }, [token]);

  // Auto-derive GST type from seller (Sunrise) state vs billing state.
  // Same state → CGST+SGST. Different → IGST.
  useEffect(() => {
    const norm = (v: any) => String(v ?? "").trim().padStart(2, "0").slice(0, 2);
    const sellerState = norm(sellerProfile.stateCode);
    const billingState = norm(estStateCode);
    if (!billingState) return;
    const next = sellerState === billingState ? "CGST+SGST" : "IGST";
    if (next !== estGstType) setEstGstType(next);
  }, [estStateCode, sellerProfile.stateCode, estGstType]);

  useEffect(() => {
    setEstItems(prev => recalculateEstimateRows(prev, estGstType));
  }, [estGstType]);

  // Overlay / Detail States
  const [selectedEstimate, setSelectedEstimate] = useState<Estimate | null>(null);
  const [selectedEstimateItems, setSelectedEstimateItems] = useState<EstimateItem[]>([]);
  const [selectedEstimateItemsLoading, setSelectedEstimateItemsLoading] = useState(false);
  const [selectedChallans, setSelectedChallans] = useState<DeliveryChallan[]>([]);
  const [poWorkflowEstimate, setPoWorkflowEstimate] = useState<Estimate | null>(null);
  const [executionDocumentViewer, setExecutionDocumentViewer] = useState<any | null>(null);
  const [executionDocumentVersions, setExecutionDocumentVersions] = useState<any[]>([]);
  const [showExecutionDocumentHistory, setShowExecutionDocumentHistory] = useState(false);
  const [standaloneDcEditor, setStandaloneDcEditor] = useState(false);
  const [estimatePreviewMode, setEstimatePreviewMode] = useState<"estimate" | "project">("estimate");
  const [projectDashboardInitialTab, setProjectDashboardInitialTab] = useState<"overview" | "po" | "execution" | "documents" | "invoice">("overview");
  
  // PO Upload Panel State
  const [showPoModal, setShowPoModal] = useState(false);
  const [poNumber, setPoNumber] = useState("");
  const [poDate, setPoDate] = useState("");
  const [poAmount, setPoAmount] = useState("");
  const [poRemarks, setPoRemarks] = useState("");
  const [poFileUrl, setPoFileUrl] = useState("");
  const [uploadingPo, setUploadingPo] = useState(false);

  const {
    showDcModal,
    setShowDcModal,
    dcNumberVal,
    setDcNumberVal,
    dcDeliveredBy,
    setDcDeliveredBy,
    dcReceivedBy,
    setDcReceivedBy,
    dcRemarks,
    setDcRemarks,
    wccVisualBrief,
    setWccVisualBrief,
    wccShortageNotes,
    setWccShortageNotes,
    wccAuthPerson,
    setWccAuthPerson,
    wccChecklist,
    setWccChecklist,
    dcPhotos,
    setDcPhotos,
    dcFormat,
    setDcFormat,
    selectedDcForPreview,
    setSelectedDcForPreview,
    showDcPreviewModal,
    setShowDcPreviewModal,
    dcWccStoreScope,
    setDcWccStoreScope,
    editingDcId,
    setEditingDcId,
    wccPrintMode,
    setWccPrintMode,
  } = useWccDcEditor();

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (document.querySelector("[data-estimate-internal-modal='true']")) return;

      if (showPoModal) {
        event.preventDefault();
        setShowPoModal(false);
        return;
      }
      if (showDcPreviewModal) {
        event.preventDefault();
        setShowDcPreviewModal(false);
        setSelectedDcForPreview(null);
        return;
      }
      if (showDcModal) {
        event.preventDefault();
        setShowDcModal(false);
        if (standaloneDcEditor) {
          setSelectedEstimate(null);
          setStandaloneDcEditor(false);
        }
        return;
      }
      if (executionDocumentViewer) {
        event.preventDefault();
        setExecutionDocumentViewer(null);
        setExecutionDocumentVersions([]);
        setShowExecutionDocumentHistory(false);
        return;
      }
      if (selectedEstimate) {
        if (focusTab === "projects") return;
        event.preventDefault();
        setSelectedEstimate(null);
      }
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [showPoModal, executionDocumentViewer, showDcPreviewModal, showDcModal, selectedEstimate, standaloneDcEditor, focusTab]);
  
  // Estimates Register filters (search + status filter shown on the Estimates tab)
  const [estimateSearch, setEstimateSearch] = useState("");
  const [estimateStatusFilter, setEstimateStatusFilter] = useState<string>("all");

  // Document Upload Tracker
  const [uploadingDocType, setUploadingDocType] = useState<string | null>(null);

  const showSuccess = (msg: string) => {
    setMessage(msg);
    setTimeout(() => setMessage(""), 4000);
  };

  const isMasterContext = MASTER_TABS.includes(activeTab);
  const pageTitle = isMasterContext ? "Masters" : activeTab === "projects" ? "Projects" : "Estimate-to-Delivery Hub";
  const pageSubtitle = isMasterContext
    ? MASTER_PAGE_TITLES[activeTab] || "Master Data"
    : "Manage corporate accounts (ABLBL) or normal clients, itemized signage quotes, PO logs, and WCC completion proofs.";

  const handleCreateClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientName) return;

    try {
      await masterDataSave(token, "clients", "POST", null, {
        name: normalizeDisplayName(clientName),
        email: clientEmail || null,
        mobile: clientPhone || null,
        city: normalizeDisplayName(clientCity) || null,
        address: clientAddress || null,
        gstNumber: normalizeGstinPan(clientGst) || null,
        format: normalizeFormatMode(clientFormatSetting),
        clientGroupName: normalizeDisplayName(clientGroupName) || null,
        clientType: clientType,
        pan: normalizeGstinPan(clientPan) || null,
        primaryContactPerson: normalizeDisplayName(clientPrimaryContact) || null,
        paymentTerms: clientPaymentTerms || null,
        vendorCode: clientVendorCodeField || null,
        isActive: true
      });
      showSuccess(`Client "${clientName}" registered successfully with ${displayFormatLabel(clientFormatSetting)} format!`);
      setShowClientForm(false);
      setClientName("");
      setClientEmail("");
      setClientPhone("");
      setClientCity("");
      setClientAddress("");
      setClientGst("");
      setClientFormatSetting("normal");
      setClientGroupName("");
      setClientType("normal");
      setClientPan("");
      setClientPrimaryContact("");
      setClientPaymentTerms("");
      setClientVendorCodeField("");
      fetchData();
    } catch (err: any) {
      console.error("Client creation failed:", err);
      alert(err.message || "Client creation failed");
    }
  };

  const handleCreateBrand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!brandName || !brandParent) return;

    try {
      await masterDataSave(token, "brands", "POST", null, {
        name: normalizeDisplayName(brandName),
        parentClientId: Number(brandParent),
        isActive: true
      });
      showSuccess(`Brand "${brandName}" registered successfully!`);
      setShowBrandForm(false);
      setBrandName("");
      setBrandParent("");
      fetchData();
    } catch (err: any) {
      console.error("Brand creation failed:", err);
      alert(err.message || "Brand creation failed");
    }
  };

  const handleCreateStore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!storeName || !storeClientId || !storeBrandId) return;

    try {
      await masterDataSave(token, "stores", "POST", null, {
        name: normalizeDisplayName(storeName),
        clientId: Number(storeClientId),
        brandId: Number(storeBrandId),
        location: storeLocation || null,
        address: storeAddress || null,
        contactPerson: normalizeDisplayName(storeContact) || null,
        contactPhone: storePhone || null,
        storeCode: storeCode || null,
        city: normalizeDisplayName(storeCity) || null,
        state: normalizeDisplayName(storeState) || null,
        stateCode: storeStateCode || null,
        regionZone: storeRegion || null,
        contact: normalizeDisplayName(storeAltContact) || null,
        isActive: true
      });
      showSuccess(`Store Site "${storeName}" registered!`);
      setShowStoreForm(false);
      setStoreName("");
      setStoreClientId("");
      setStoreBrandId("");
      setStoreLocation("");
      setStoreAddress("");
      setStoreContact("");
      setStorePhone("");
      setStoreCode("");
      setStoreCity("");
      setStoreState("");
      setStoreStateCode("");
      setStoreRegion("");
      setStoreAltContact("");
      fetchData();
    } catch (err: any) {
      console.error("Store creation failed:", err);
      alert(err.message || "Store creation failed");
    }
  };

  const fetchBillingProfiles = async (clientId: number) => {
    try {
      const res = await fetch(`/api/operations/clients/${clientId}/billing-profiles`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const list = await res.json();
        setBillingProfiles(list);
      }
    } catch (err) {
      console.error("Failed to fetch billing profiles:", err);
    }
  };

  const handleCreateOrUpdateBillingProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClientForProfiles || !bpLegalName || !bpGstin || !bpState || !bpStateCode || !bpBillingAddress) {
      alert("Please fill all required billing profile fields!");
      return;
    }

    const payload = {
      clientId: selectedClientForProfiles.id,
      legalCompanyName: normalizeDisplayName(bpLegalName),
      branchLocationName: normalizeDisplayName(bpBranch) || null,
      gstin: normalizeGstinPan(bpGstin),
      pan: normalizeGstinPan(bpPan) || null,
      state: normalizeDisplayName(bpState),
      stateCode: bpStateCode,
      billingAddress: bpBillingAddress,
      shippingAddress: bpShippingAddress || null,
      contactPerson: normalizeDisplayName(bpContactPerson) || null,
      mobile: bpMobile || null,
      email: bpEmail || null,
      isDefault: bpIsDefault,
      isActive: bpIsActive,
      notes: bpNotes || null
    };

    try {
      await masterDataSave(
        token,
        "billing-profiles",
        editingBpId ? "PATCH" : "POST",
        editingBpId || null,
        payload
      );
      showSuccess(editingBpId ? "Billing Profile updated!" : "Billing Profile added!");
      setBpLegalName("");
      setBpBranch("");
      setBpGstin("");
      setBpPan("");
      setBpState("");
      setBpStateCode("");
      setBpBillingAddress("");
      setBpShippingAddress("");
      setBpContactPerson("");
      setBpMobile("");
      setBpEmail("");
      setBpIsDefault(false);
      setBpIsActive(true);
      setBpNotes("");
      setEditingBpId(null);
      setShowBpForm(false);
      fetchBillingProfiles(selectedClientForProfiles.id);
    } catch (err: any) {
      console.error("Save billing profile failed:", err);
      alert(`Error: ${err.message || "Failed to save billing profile"}`);
    }
  };

  const handleDeleteBillingProfile = async (id: number) => {
    if (!confirm("Are you sure you want to delete this billing profile?")) return;
    try {
      await masterDataSave(token, "billing-profiles", "DELETE", id);
      showSuccess("Billing Profile deleted!");
      if (selectedClientForProfiles) {
        fetchBillingProfiles(selectedClientForProfiles.id);
      }
    } catch (err: any) {
      console.error("Delete billing profile failed:", err);
      alert(err.message || "Delete failed");
    }
  };

  const handleImportFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    if (isBoltMode) { alert("Import migration pending. Bulk import is not yet available in Bolt preview mode."); return; }
    setImpFileName(file.name);
    setImpIsParsing(true);
    setImpStats(null);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/operations/imports/parse-file", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      });

      if (res.ok) {
        const data = await res.json();
        setImpHeaders(data.headers);
        setImpPreviewRows(data.previewRows);
        setImpAllRows(data.allRows);
        
        // Auto-match mappings based on synonyms
        const initialMappings: Record<string, string> = {};
        const destFields = importFieldsMap[impType] || [];
        
        destFields.forEach(f => {
          const synonymList = [
            f.key.toLowerCase(),
            f.label.toLowerCase(),
            f.key.replace(/([A-Z])/g, "_$1").toLowerCase(), // snake_case
            f.label.replace(/\s+/g, "_").toLowerCase(),
            f.label.replace(/\s+/g, "").toLowerCase()
          ];
          const normalizedSynonyms = [...synonymList, ...(f.synonyms || [])].map(normalizeImportHeader);
          const matchedHeader = data.headers.find((h: string) =>
            normalizedSynonyms.includes(normalizeImportHeader(h))
          );
          if (matchedHeader) {
            initialMappings[f.key] = matchedHeader;
          }
        });
        setImpMappings(initialMappings);
        showSuccess(`Excel/CSV file parsed! Found ${data.headers.length} headers and ${data.allRows.length} rows.`);
      } else {
        const errData = await res.json();
        alert(`Parsing failed: ${errData.message || "Unknown error"}`);
      }
    } catch (err) {
      console.error("Failed to parse import file:", err);
      alert("Error parsing uploaded spreadsheet!");
    } finally {
      setImpIsParsing(false);
    }
  };

  const handleCommitImport = async () => {
    if (impAllRows.length === 0) return;
    setImpIsCommitting(true);
    setImpStats(null);

    const mappedItems = impAllRows.map(row => {
      const item: Record<string, any> = {};
      const fields = importFieldsMap[impType] || [];
      fields.forEach(f => {
        const mappedHeader = impMappings[f.key];
        if (mappedHeader && row[mappedHeader] !== undefined) {
          item[f.key] = row[mappedHeader];
        }
      });
      return item;
    });

    try {
      const res = await fetch(`/api/operations/imports/${impType}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ items: mappedItems })
      });

      if (res.ok) {
        const stats = await res.json();
        setImpStats(stats);
        showSuccess(`Master import completed successfully!`);
        fetchData();
        // Clear file selections
        setImpHeaders([]);
        setImpPreviewRows([]);
        setImpAllRows([]);
        setImpMappings({});
        setImpFileName("");
      } else {
        const errData = await res.json();
        alert(`Import failed: ${errData.message || "Unknown error"}`);
      }
    } catch (err) {
      console.error("Commit import failed:", err);
      alert("Error executing bulk import!");
    } finally {
      setImpIsCommitting(false);
    }
  };

  const handleCreateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prodName || !prodRate) return;

    try {
      await masterDataSave(token, "products", "POST", null, {
        name: prodName,
        category: normalizeDisplayName(prodCat) || null,
        unit: prodUnit,
        rate: Number(prodRate),
        description: prodDesc || null,
        hsnSac: prodHsn.trim().toUpperCase() || null,
        isStandard: prodIsStandard,
        calculationType: prodCalcType,
        gstPercent: Number(prodGst) || 18,
        defaultSpecification: prodSpecs || null,
        warranty: prodWarranty || null,
        materialCodeId: prodMaterialCodeId ? parseInt(prodMaterialCodeId, 10) : null,
        isActive: true
      });
      showSuccess(`Product "${prodName}" added to catalog!`);
      setShowProductForm(false);
      setProdName("");
      setProdCat("");
      setProdUnit("sqft");
      setProdRate("");
      setProdDesc("");
      setProdHsn("");
      setProdIsStandard(true);
      setProdCalcType("sqft");
      setProdGst("18");
      setProdSpecs("");
      setProdWarranty("");
      setProdMaterialCodeId("");
      fetchData();
    } catch (err: any) {
      console.error("Product creation failed:", err);
      alert(err.message || "Product creation failed");
    }
  };

  const handleProductSelectChange = (index: number, productIdVal: string) => {
    const updated = [...estItems];
    updated[index].productId = productIdVal;

    // Auto-fill row details
    const selectedProd = products.find(p => p.id === Number(productIdVal));
    if (selectedProd) {
      updated[index].unit = selectedProd.unit;
      updated[index].calculationType = selectedProd.calculationType;
      updated[index].hsn = selectedProd.hsnSac || "";
      updated[index].isStandard = selectedProd.isStandard;
      updated[index].rate = selectedProd.rate.toString();
      updated[index].rateSource = "default";
      updated[index].description = formatProductDetails(selectedProd, "", updated[index].itemName);
      updated[index].materialCodeId = null;
      updated[index].materialCode = "";
      updated[index].materialDescription = "";

      // Auto-fill material code from product's linked material code (additive)
      if (selectedProd.materialCodeId) {
        const linkedMc = materialCodes.find(m => m.id === selectedProd.materialCodeId);
        if (linkedMc) {
          updated[index].materialCodeId = linkedMc.id;
          updated[index].materialCode = linkedMc.code;
          updated[index].materialDescription = linkedMc.description || "";
          if (!updated[index].hsn && linkedMc.hsn) updated[index].hsn = linkedMc.hsn;
        } else {
          // legacy text material code on product
          updated[index].materialCode = selectedProd.materialCode || "";
        }
      } else {
        // fallback: legacy text-only material code field on product
        updated[index].materialCode = selectedProd.materialCode || "";
      }

      const calc = calculateEstimateRowValues(
        selectedProd.calculationType,
        Number(updated[index].width) || 0,
        Number(updated[index].height) || 0,
        Number(updated[index].quantity) || 1,
        selectedProd.rate,
        selectedProd.gstPercent || 18,
        estGstType
      );

      Object.assign(updated[index], calc);
    }
    setEstItems(recalculateEstimateRows(updated));

    // Fire-and-forget rate-card lookup. Overwrites the just-set product
    // default if a more specific match is configured for this customer.
    if (selectedProd && estClientId) {
      void resolveRateForRow(index, {
        productId: selectedProd.id,
        materialCodeId: updated[index].materialCodeId ?? null,
      });
    }
  };

  // Resolves the customer's rate for a row. Mutates the row in-place with
  // the resolved rate/GST/UOM and marks `rateSource = "rate_card"`. No-op
  // when no client is selected or the API returns null.
  const resolveRateForRow = async (
    index: number,
    opts: { productId?: number | null; materialCodeId?: number | null },
  ) => {
    if (!estClientId) return;
    try {
      const params = new URLSearchParams({ clientId: estClientId });
      if (estBrandId) params.set("brandId", estBrandId);
      if (opts.productId) params.set("productId", String(opts.productId));
      if (opts.materialCodeId) params.set("materialCodeId", String(opts.materialCodeId));
      if (isAblblFormat(estFormat)) {
        params.set("projectType", estAbfrlProjectType);
      }
      const r = await fetch(`/api/customer-rate-cards/resolve?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) return;
      const data = await r.json();
      if (!data) return;
      setEstItems(prev => {
        const next = [...prev];
        const row = next[index];
        if (!row) return prev;
        row.rate = String(data.rate);
        if (data.uom) row.unit = data.uom;
        row.rateSource = "rate_card";
        const gst = Number(data.gstPercent ?? 18);
        const calc = calculateEstimateRowValues(
          row.calculationType,
          Number(row.width) || 0,
          Number(row.height) || 0,
          Number(row.quantity) || 1,
          Number(data.rate),
          gst,
          estGstType,
        );
        Object.assign(row, calc);
        next[index] = row;
        return recalculateEstimateRows(next, estGstType);
      });
    } catch {
      /* network failures fall back to whatever default we set above */
    }
  };

  const handleEstimateItemChange = (index: number, field: string, val: string) => {
    const updated = [...estItems];
    updated[index] = { ...updated[index], [field]: val } as EstimateItemInput;

    // Letter-signage helper: when user types individual letter sizes like
    // "27,26,26,26,28,27,27", parse them, sum the inches, and write into
    // `width` so the row total picks up the new running-inch total. Empty
    // string clears the breakdown but leaves the row otherwise untouched.
    if (field === "letterSizes") {
      const parts = String(val).split(/[,\s]+/).filter(p => p.length > 0);
      const total = parts.reduce((s, p) => s + (Number(p) || 0), 0);
      if (total > 0) updated[index].width = String(total);
    }

    // Manual rate edits override the auto-fill — flag the source so the row
    // pill flips to "Manual".
    if (field === "rate") {
      updated[index].rateSource = "manual";
    }

    setEstItems(recalculateEstimateRows(updated));
  };

  const addEstimateItem = () => {
    setEstItems([...estItems, {
      sl: estItems.length + 1,
      productId: "",
      isStandard: true,
      hsn: "",
      materialCode: "",
      itemName: "",
      width: "0",
      height: "0",
      quantity: "1",
      unit: "sqft",
      calculationType: "sqft",
      rate: "0",
      amount: "0",
      cgstPercent: "9",
      cgstAmount: "0",
      sgstPercent: "9",
      sgstAmount: "0",
      igstPercent: "0",
      igstAmount: "0",
      totalAmount: "0",
      storeId: "",
      lineType: "product",
    }]);
  };

  // Look up a service product by name from Product Master (category "Services").
  // Used by the four service buttons (Packing / Installation / Local Transport /
  // Outstation) to source HSN, GST%, calc type, rate, and material code from
  // the live master record instead of hardcoded constants. Logs a warning when
  // the product is missing so the fallback chain (settings → constants) is
  // visible in DevTools — re-run `node scripts/migrate-seed-services.mjs` to
  // reseed.
  const findServiceProduct = (canonicalName: string) => {
    const found = products.find(p =>
      p.isActive
      && String(p.name || "").trim().toLowerCase() === canonicalName.toLowerCase()
    );
    if (!found) {
      console.warn(
        `[ServiceProducts] Missing system service "${canonicalName}" in Product Master ` +
        `(category "Services"). Falling back to legacy settings/hardcoded defaults. ` +
        `Run: node scripts/migrate-seed-services.mjs`
      );
    }
    return found;
  };

  // Keeps only the first packing/installation/transport row per store.
  const deduplicateSpecialCharges = <T extends { lineType?: string; storeId?: string }>(items: T[]): T[] => {
    const seen = new Map<string, Set<string>>();
    return items.filter(item => {
      if (!["packing", "installation", "transport"].includes(item.lineType ?? "")) return true;
      const key = String(item.storeId ?? "");
      if (!seen.has(key)) seen.set(key, new Set());
      const storeSet = seen.get(key)!;
      if (storeSet.has(item.lineType!)) return false;
      storeSet.add(item.lineType!);
      return true;
    });
  };

  const addServiceItem = (
    storeId: string,
    lineType: "packing" | "installation" | "transport",
    materialCodeValue: string,
    fallbackHsn: string,
    fallbackName: string,
    defaultRate: string,
    fallbackDescription: string,
    overrides: Partial<EstimateItemInput> = {},
    serviceProduct?: any,
  ) => {
    // Material code is now optional — if missing, fall back to legacy material
    // code lookup, then to the constant. Service product (when present) is the
    // primary source of truth.
    const serviceMc = materialCodes.find(m => m.code === materialCodeValue && m.isActive);

    const rateInput = defaultRate;
    const isPercent = isPercentageRateInput(rateInput) || serviceProduct?.calculationType === "percentage";
    const productCalcType = serviceProduct?.calculationType
      || (isPercent ? "percentage" : "fixed");

    // GST % from product (if set) → defaults to 18 for back-compat.
    const gstPct = Number(serviceProduct?.gstPercent ?? 18) || 18;
    const halfGst = gstPct / 2;
    const cgstPct = estGstType === "IGST" ? "0" : String(halfGst);
    const sgstPct = estGstType === "IGST" ? "0" : String(halfGst);
    const igstPct = estGstType === "IGST" ? String(gstPct) : "0";

    const baseRow: EstimateItemInput = {
      sl: estItems.length + 1,
      productId: serviceProduct?.id ? String(serviceProduct.id) : "",
      isStandard: serviceProduct?.isStandard ?? true,
      // Precedence: product master → material code → fallback constant
      hsn: serviceProduct?.hsnSac || serviceMc?.hsn || fallbackHsn,
      materialCode: serviceProduct?.materialCode || serviceMc?.code || materialCodeValue,
      materialCodeId: serviceMc?.id ?? null,
      itemName: serviceProduct?.name || serviceMc?.productName || fallbackName,
      description: fallbackDescription,
      width: "",
      height: "",
      quantity: "1",
      unit: serviceProduct?.unit || serviceMc?.uom || "job",
      calculationType: productCalcType,
      rate: rateInput,
      amount: "0",
      cgstPercent: cgstPct,
      cgstAmount: "0",
      sgstPercent: sgstPct,
      sgstAmount: "0",
      igstPercent: igstPct,
      igstAmount: "0",
      totalAmount: "0",
      storeId,
      lineType,
      ...overrides,
    };

    setEstItems(prev => recalculateEstimateRows([...prev, baseRow]));
  };

  // Source-of-truth order for service buttons:
  //   1. Product Master entry (category "Services", matching name)
  //   2. Legacy app_settings defaults (sellerProfile.defaultPacking, etc.)
  //   3. Hardcoded fallback constant
  // The product master takes precedence so admins can edit GST/HSN/rate/calc
  // type in one place and have all new estimates pick it up.
  const addPackingItem = (storeId: string) => {
    if (estItems.some(it => it.lineType === "packing" && it.storeId === storeId)) {
      alert("Packing Charge already exists in this estimate.");
      return;
    }
    const sp = findServiceProduct("Packing Charges");
    const settingsValue = sellerProfile.defaultPacking ?? estPacking;
    const rateValue = sp?.rate != null ? String(sp.rate) : settingsValue;
    const rateInput = (sp?.calculationType ?? "percentage") === "percentage"
      ? settingsPercentRate(rateValue)
      : String(rateValue ?? "");
    const label = serviceChargeLabel(sp?.name || "Packing Charges", rateInput);
    addServiceItem(
      storeId,
      "packing",
      sp?.materialCode || "OT_PACKING000N",
      sp?.hsnSac || "996511",
      label,
      rateInput,
      label,
      {},
      sp,
    );
  };

  const addInstallationItem = (storeId: string) => {
    if (estItems.some(it => it.lineType === "installation" && it.storeId === storeId)) {
      alert("Installation Charge already exists in this estimate.");
      return;
    }
    const sp = findServiceProduct("Installation Charges");
    const settingsValue = sellerProfile.defaultImplementation ?? estImplementation;
    const rateValue = sp?.rate != null ? String(sp.rate) : settingsValue;
    const rateInput = (sp?.calculationType ?? "percentage") === "percentage"
      ? settingsPercentRate(rateValue)
      : String(rateValue ?? "");
    const label = serviceChargeLabel(sp?.name || "Installation Charges", rateInput);
    addServiceItem(
      storeId,
      "installation",
      sp?.materialCode || "OT_INSTALLATION00N",
      sp?.hsnSac || "995415",
      label,
      rateInput,
      label,
      {},
      sp,
    );
  };

  const addTransportItem = (storeId: string, mode: "local" | "outstation" = "local") => {
    if (estItems.some(it => it.lineType === "transport" && it.storeId === storeId)) {
      alert("Transportation Charge already exists in this estimate.");
      return;
    }
    const sp = mode === "outstation"
      ? findServiceProduct("Outstation Charges")
      : findServiceProduct("Local Transportation");
    const fallbackRate = mode === "outstation"
      ? String(sellerProfile.defaultOutstationTransportRate ?? "")
      : String(sellerProfile.defaultLocalTransport ?? estTransport ?? "");
    const rateInput = sp?.rate != null ? String(sp.rate) : fallbackRate;
    const description = sp?.description
      || sp?.name
      || (mode === "outstation" ? outstationTransportLabel(rateInput) : "Local Transportation");
    addServiceItem(
      storeId,
      "transport",
      sp?.materialCode || "OT_TRANSPORT001N",
      sp?.hsnSac || "996511",
      description,
      rateInput,
      description,
      mode === "outstation"
        ? { quantity: "0", unit: sp?.unit || "km", calculationType: sp?.calculationType || "per_km" }
        : { quantity: "1", unit: sp?.unit || "job", calculationType: sp?.calculationType || "fixed" },
      sp,
    );
  };

  const removeEstimateItem = (index: number) => {
    if (estItems.length <= 1) return;
    const updated = estItems.filter((_, i) => i !== index).map((item, idx) => ({ ...item, sl: idx + 1 }));
    setEstItems(recalculateEstimateRows(updated));
  };

  const deleteEstimateItems = (indexes: number[]) => {
    const selected = new Set(indexes);
    if (selected.size === 0) return;
    const updated = estItems
      .filter((_, index) => !selected.has(index))
      .map((item, idx) => ({ ...item, sl: idx + 1 }));
    setEstItems(recalculateEstimateRows(updated));
  };

  const previewExcelPaste = () => {
    const parsed = validateExcelPasteRows(pasteText);
    if (!parsed.ok) {
      setPastePreviewRows([]);
      setPasteError(parsed.error);
      return;
    }
    setPastePreviewRows(parsed.rows);
    setPasteError("");
  };

  const applyExcelPaste = () => {
    const sid = pasteModalStoreId;
    if (!sid) return;
    if (pastePreviewRows.length === 0) {
      previewExcelPaste();
      return;
    }
    setEstItems(prev => {
      const next = [...prev];
      pastePreviewRows.forEach(p => {
        const base = blankRowForStore(sid, next.length + 1, estGstType);
        const merged: EstimateItemInput = { ...base, ...p, storeId: sid, sl: next.length + 1 };
        // Recompute amount / GST / total from width × height × qty × rate.
        const calc = calculateEstimateRowValues(
          merged.calculationType,
          Number(merged.width) || 0,
          Number(merged.height) || 0,
          Number(merged.quantity) || 0,
          Number(merged.rate) || 0,
          estGstType === "IGST" ? 18 : 18,
          estGstType,
        );
        Object.assign(merged, calc);
        next.push(merged);
      });
      return recalculateEstimateRows(next);
    });
    setPasteModalStoreId(null);
    setPasteText("");
    setPasteError("");
    setPastePreviewRows([]);
  };

  const isBlankEstimateLine = (row: EstimateItemInput) => {
    if (isServiceLineType(row.lineType)) return false;
    const hasText = [
      row.productId,
      row.hsn,
      row.materialCode,
      row.materialDescription,
      row.itemName,
      row.description,
      row.width,
      row.height,
      row.rate,
      row.letterSizes,
    ].some(value => String(value ?? "").trim().length > 0);
    if (hasText) return false;
    return (Number(row.quantity) || 1) === 1
      && (Number(row.amount) || 0) === 0
      && (Number(row.totalAmount) || 0) === 0;
  };

  const cloneEstimateLineForStore = (
    row: EstimateItemInput,
    destinationStoreId: string,
    sl: number,
  ): EstimateItemInput => ({
    sl,
    productId: String(row.productId ?? ""),
    isStandard: row.isStandard !== false,
    hsn: row.hsn || "",
    materialCode: row.materialCode || "",
    materialCodeId: row.materialCodeId ?? null,
    materialDescription: row.materialDescription || "",
    itemName: row.itemName || "",
    description: row.description || "",
    width: row.width ?? "",
    height: row.height ?? "",
    quantity: row.quantity ?? "1",
    unit: row.unit || "sqft",
    calculationType: row.calculationType || "sqft",
    rate: row.rate ?? "",
    amount: row.amount ?? "0",
    cgstPercent: row.cgstPercent ?? (estGstType === "IGST" ? "0" : "9"),
    cgstAmount: row.cgstAmount ?? "0",
    sgstPercent: row.sgstPercent ?? (estGstType === "IGST" ? "0" : "9"),
    sgstAmount: row.sgstAmount ?? "0",
    igstPercent: row.igstPercent ?? (estGstType === "IGST" ? "18" : "0"),
    igstAmount: row.igstAmount ?? "0",
    totalAmount: row.totalAmount ?? "0",
    storeId: destinationStoreId,
    storeSortOrder: row.storeSortOrder ?? sl,
    rowSortOrder: sl,
    lineType: row.lineType || "product",
    rateSource: row.rateSource || "",
    letterSizes: row.letterSizes || undefined,
  });

  const storeNameForMessage = (storeId: string) => {
    const store = stores.find(s => String(s.id) === String(storeId));
    return store?.name || estStoreOverrides[storeId]?.storeName || `store ${storeId}`;
  };

  const copyItemsFromStore = (sourceStoreId: string, destinationStoreId: string) => {
    const sourceSid = String(sourceStoreId || "");
    const destinationSid = String(destinationStoreId || "");
    if (!sourceSid || !destinationSid || sourceSid === destinationSid) return;

    const sourceRows = estItems
      .filter(row => String(row.storeId || "") === sourceSid)
      .filter(row => !isBlankEstimateLine(row));

    if (sourceRows.length === 0) {
      setMessage("Source store has no line items to copy.");
      setTimeout(() => setMessage(""), 4000);
      return;
    }

    const retainedRows = estItems.filter(row => {
      const belongsToDestination = String(row.storeId || "") === destinationSid;
      return !(belongsToDestination && isBlankEstimateLine(row));
    });
    const copiedRows = sourceRows.map((row, index) =>
      cloneEstimateLineForStore(row, destinationSid, retainedRows.length + index + 1)
    );
    const next = [...retainedRows, ...copiedRows]
      .map((item, index) => ({ ...item, sl: index + 1 }));

    setEstItems(recalculateEstimateRows(next, estGstType));
    showSuccess(`${sourceRows.length} line item${sourceRows.length === 1 ? "" : "s"} copied from ${storeNameForMessage(sourceSid)}.`);
  };

  // Duplicate a single row directly below the source. SL numbers are
  // re-sequenced afterwards. Critical for ABFRL rollouts where the same item
  // repeats across many stores.
  const duplicateEstimateItem = (index: number) => {
    const src = estItems[index];
    if (!src) return;
    const copy = { ...src };
    const next = [...estItems.slice(0, index + 1), copy, ...estItems.slice(index + 1)]
      .map((item, idx) => ({ ...item, sl: idx + 1 }));
    setEstItems(recalculateEstimateRows(next));
  };

  // Copy one or more rows to the session clipboard (does not modify the grid).
  const copyEstimateItemToClipboard = (indexes: number[]) => {
    const rows = indexes.map(i => estItems[i]).filter(Boolean);
    if (rows.length === 0) return;
    setRowClipboard(rows.map(src => ({ ...src })));
  };

  // Paste clipboard rows directly below `index`. No-op if clipboard empty.
  const pasteRowBelow = (index: number) => {
    if (!rowClipboard || rowClipboard.length === 0) return;
    const next = [
      ...estItems.slice(0, index + 1),
      ...rowClipboard.map(r => ({ ...r })),
      ...estItems.slice(index + 1),
    ].map((item, idx) => ({ ...item, sl: idx + 1 }));
    setEstItems(recalculateEstimateRows(next));
  };

  // Bulk-duplicate every row that belongs to `sourceStoreId` and re-attach the
  // copies to `targetStoreId`. Used for ABFRL multi-store: enter items once for
  // store A, then clone them to stores B/C/D and tweak only the deltas.
  const duplicateStoreSection = (sourceStoreId: string, targetStoreId: string) => {
    if (!sourceStoreId || !targetStoreId || sourceStoreId === targetStoreId) return;
    const sourceRows = estItems.filter(it => String(it.storeId) === String(sourceStoreId));
    if (sourceRows.length === 0) return;
    const copies = sourceRows.map(r => ({ ...r, storeId: String(targetStoreId) }));
    const next = [...estItems, ...copies].map((item, idx) => ({ ...item, sl: idx + 1 }));
    setEstItems(recalculateEstimateRows(next));
  };

  // Drop every row attached to a given store (use before re-importing).
  const clearStoreSection = (storeIdToClear: string) => {
    if (!storeIdToClear) return;
    const remaining = estItems.filter(it => String(it.storeId) !== String(storeIdToClear));
    if (remaining.length === 0) {
      setEstItems(estItems); // refuse to wipe everything; leave a row behind
      return;
    }
    setEstItems(recalculateEstimateRows(remaining.map((item, idx) => ({ ...item, sl: idx + 1 }))));
  };

  const handleClientSelectChange = async (clientIdVal: string) => {
    setEstClientId(clientIdVal);
    // Client controls Brand + Store. Reset both so a stale brand/store from a
    // previously selected client can't survive into the new context.
    setEstBrandId("");
    setEstItems([]);
    setEstStoreOverrides({});
    const selectedCli = clients.find(c => c.id === Number(clientIdVal));
    if (selectedCli) {
      setEstFormat(normalizeFormatMode(selectedCli.format));
      // Seed Billing block with company name on line 1, address below.
      // Print/export expects this multi-line shape (whiteSpace: pre-wrap).
      const billingText = [
        selectedCli.name ? `M/S : ${selectedCli.name}` : "",
        selectedCli.address || "",
      ].filter(Boolean).join("\n");
      setEstBillingTo(billingText);
      setEstGstin(selectedCli.gstNumber || "");
      setEstStateCode(selectedCli.gstNumber ? selectedCli.gstNumber.slice(0, 2) : "");
      // Vendor code auto-fills from the client master (lives on Client now).
      setEstVendorCode(selectedCli.vendorCode || "");
      setEstPan(selectedCli.pan || "");

      // Load billing profiles for the client
      try {
        const list = isBoltMode
          ? await apiFetchBillingProfiles(token, Number(clientIdVal))
          : await fetch(`/api/operations/clients/${clientIdVal}/billing-profiles`, {
              headers: { Authorization: `Bearer ${token}` }
            }).then(res => res.ok ? res.json() : []);
        if (list) {
          setClientBillingProfilesList(list);
          const pickBp = (bp: any) => {
            setEstBillingProfileId(String(bp.id));
            const bpText = [
              bp.legalCompanyName ? `M/S : ${bp.legalCompanyName}` : "",
              bp.billingAddress || "",
            ].filter(Boolean).join("\n");
            setEstBillingTo(bpText || bp.legalCompanyName);
            setEstGstin(bp.gstin);
            setEstStateCode(bp.stateCode);
            setEstPan(bp.pan || "");
          };
          const defaultBp = list.find((p: any) => p.isDefault);
          if (defaultBp) {
            pickBp(defaultBp);
          } else if (list.length > 0) {
            pickBp(list[0]);
          } else {
            setEstBillingProfileId("");
          }
        }
      } catch (e) {
        console.error("Failed to load profiles for estimate selection:", e);
      }
    } else {
      setClientBillingProfilesList([]);
      setEstBillingProfileId("");
    }
  };

  const handleStoreSelectChange = (storeIdVal: string) => {
    setEstStoreId(storeIdVal);
    if (!storeIdVal) return;

    const selectedStore = stores.find(s => s.id === Number(storeIdVal));
    if (selectedStore && (selectedStore.state || selectedStore.location)) {
      const storeStateVal = selectedStore.state || selectedStore.location || "";
      // Find a billing profile that matches the state
      const matchingBp = clientBillingProfilesList.find(bp => 
        bp.state.toLowerCase() === storeStateVal.toLowerCase() || 
        bp.stateCode.toLowerCase() === (selectedStore.stateCode || "").toLowerCase()
      );
      
      if (matchingBp) {
        setEstBillingProfileId(String(matchingBp.id));
        const bpText = [
          matchingBp.legalCompanyName ? `M/S : ${matchingBp.legalCompanyName}` : "",
          matchingBp.billingAddress || "",
        ].filter(Boolean).join("\n");
        setEstBillingTo(bpText || matchingBp.legalCompanyName);
        setEstGstin(matchingBp.gstin);
        setEstStateCode(matchingBp.stateCode);
        setEstPan(matchingBp.pan || "");
        showSuccess(`Auto-selected GST Profile: "${matchingBp.legalCompanyName}" based on store state: ${storeStateVal}`);
      }
    }
  };

  const handleCreateEstimate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    if ((!isBoltMode && !estNumber) || !estClientId || !estBrandId) return;
    if (!estTitle && !estSubject) return;

    // Phase 7: Validate estimate items
    const itemsValidation = validateEstimateItems(estItems);
    if (!itemsValidation.valid) {
      setMessage(itemsValidation.error || "Estimate must have at least one item");
      setTimeout(() => setMessage(""), 6000);
      return;
    }

    // Phase 7: Validate all items (quantity, rate, HSN)
    const batchValidation = validateEstimateItemsBatch(estItems);
    if (!batchValidation.valid) {
      setMessage(batchValidation.errors.join("; "));
      setTimeout(() => setMessage(""), 8000);
      return;
    }

    // Phase 7: Validate GSTIN format
    if (estGstin) {
      const gstinValidation = validateGstin(estGstin);
      if (!gstinValidation.valid) {
        setMessage(gstinValidation.error || "Invalid GSTIN");
        setTimeout(() => setMessage(""), 6000);
        return;
      }
    }

    // Phase 7: Validate PAN format
    if (estPan) {
      const panValidation = validatePan(estPan);
      if (!panValidation.valid) {
        setMessage(panValidation.error || "Invalid PAN");
        setTimeout(() => setMessage(""), 6000);
        return;
      }
    }

    // ABFRL CAPEX rule: every line must have a material code.
    // ABFRL SELEX: material code is optional.
    // Non-ABFRL: not enforced.
    const isAbfrl = isAblblFormat(estFormat);
    if (isAbfrl && estAbfrlProjectType === "CAPEX") {
      const missing = estItems
        .map((it, i) => ({ sl: it.sl ?? i + 1, mc: it.materialCode, id: it.materialCodeId }))
        .filter(r => !r.mc && !r.id);
      if (missing.length > 0) {
        const msg = `ABLBL CAPEX requires a Material Code on every row. Missing on row(s): ${missing.map(m => m.sl).join(", ")}.`;
        setMessage(msg);
        setTimeout(() => setMessage(""), 6000);
        return;
      }
    }

    const _t0 = performance.now();
    const _ms = () => Math.round(performance.now() - _t0);
    console.log(`[save] handler entered`, { editingEstimateId, estNumber, items: estItems.length });
    setIsSaving(true);
    try {
      const dedupedItems = deduplicateSpecialCharges(estItems);
      if (dedupedItems.length !== estItems.length) {
        console.warn(`[save] Removed ${estItems.length - dedupedItems.length} duplicate special charge row(s) before saving`);
      }
      const normalizedItems = recalculateEstimateRows(dedupedItems);
      const formattedItems = normalizedItems.map(item => {
        const selectedProduct = item.productId
          ? products.find(p => p.id === Number(item.productId))
          : null;
        const productDetails = selectedProduct
          ? formatProductDetails(selectedProduct, item.description || "", item.itemName)
          : (sameDisplayText(item.description, item.itemName) ? "" : item.description || "");

        return {
          productId: item.productId ? Number(item.productId) : null,
          itemName: item.itemName,
          description: productDetails,
          quantity: Number(item.quantity) || 1,
          unit: item.unit,
          calculationType: isServiceLineType(item.lineType)
            ? (isPercentageRateInput(item.rate) ? "percentage" : "fixed")
            : (item.calculationType || "fixed"),
          rate: parseRateInput(item.rate),
          totalPrice: Number(item.amount) || 0,
          sl: Number(item.sl),
          isStandard: item.isStandard,
          hsn: item.hsn,
          materialCode: item.materialCode || "",
          materialCodeId: item.materialCodeId ?? null,
          materialDescription: item.materialDescription || null,
          width: Number(item.width) || 0,
          height: Number(item.height) || 0,
          totalSize: (() => {
            // Mirror estimateCalculations.ts auto-detect:
            //   - running_inch        → W × H × Q
            //   - else with area > 0  → (W × H × Q) / 144     (area-based)
            //   - else                → Q                      (piece-based)
            const w = Number(item.width) || 0;
            const h = Number(item.height) || 0;
            const q = Number(item.quantity) || 1;
            if (item.calculationType === "running_inch") return w * h * q;
            const area = (w * h * q) / 144;
            return area > 0 ? area : q;
          })(),
          cgstPercent: Number(item.cgstPercent) || 0,
          cgstAmount: Number(item.cgstAmount) || 0,
          sgstPercent: Number(item.sgstPercent) || 0,
          sgstAmount: Number(item.sgstAmount) || 0,
          igstPercent: Number(item.igstPercent) || 0,
          igstAmount: Number(item.igstAmount) || 0,
          totalAmount: Number(item.totalAmount) || 0,
          storeSortOrder: Number(item.storeSortOrder) || 0,
          rowSortOrder: Number(item.rowSortOrder) || Number(item.sl) || 0,
          lineType: item.lineType || "product",
          storeCode: item.storeCode || null
        };
      });

      const cleanedItems = deduplicateSpecialCharges(normalizedItems);
      if (cleanedItems.length !== normalizedItems.length) {
        console.warn(`[EstimateLoad] Auto-removed ${normalizedItems.length - cleanedItems.length} duplicate special charge row(s) from estimate`);
      }
      setEstItems(cleanedItems);

      const storeGrouping = buildStoreGrouping(cleanedItems, estStoreOverrides, "0", "0");
      const estimateSubtotal = normalizedItems.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
      const estimateTax = normalizedItems.reduce(
        (sum, item) => sum
          + (Number(item.cgstAmount) || 0)
          + (Number(item.sgstAmount) || 0)
          + (Number(item.igstAmount) || 0),
        0,
      );
      const estimateGrandTotal = estimateSubtotal + estimateTax;

      const estimatePayload = {
        estimateNumber: estNumber,
        estimateDate: estDate || todayYmd,
        clientId: Number(estClientId),
        brandId: Number(estBrandId),
        storeId: Number(estStoreId)
          || Number(Object.keys(storeGrouping)[0])
          || stores.find(s => s.clientId === Number(estClientId))?.id
          || 1,
        title: estTitle || estSubject || estNumber,
        description: estDescription || null,
        subtotal: estimateSubtotal,
        taxAmount: estimateTax,
        totalAmount: estimateGrandTotal,
        ...(editingEstimateId ? {} : { status: "draft" }),
        clientFormat: normalizeFormatMode(estFormat),
        subject: estSubject || null,
        billingTo: estBillingTo || null,
        shippingTo: estShippingTo || null,
        gstin: estGstin || null,
        pan: estPan || null,
        stateCode: estStateCode || null,
        vendorCode: estVendorCode || null,
        gstType: estGstType,
        packingPercent: 0,
        implementationPercent: 0,
        transportAmount: 0,
        storeGrouping: Object.keys(storeGrouping).length > 0 ? storeGrouping : null,
        billingProfileId: estBillingProfileId ? Number(estBillingProfileId) : null,
        abfrlProjectType: isAblblFormat(estFormat) ? estAbfrlProjectType : null,
      };

      const url = editingEstimateId ? `/api/operations/estimates/${editingEstimateId}` : "/api/operations/estimates";
      const method = editingEstimateId ? "PATCH" : "POST";
      console.log(`[save] request start (${_ms()}ms)`, { method, url, bytes: JSON.stringify(formattedItems).length });
      let res: Response;
      if (isBoltMode) {
        try {
          const data = editingEstimateId
            ? await updateEstimate(token, editingEstimateId, { ...estimatePayload, items: formattedItems })
            : await createEstimate(token, { estimate: estimatePayload, items: formattedItems });
          res = new Response(JSON.stringify(data), { status: 200 });
        } catch (err: any) {
          res = new Response(JSON.stringify({ message: err.message }), { status: 500 });
        }
      } else {
        // Hard timeout so a stalled server can't strand the UI on "Saving...".
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), 25_000);
        try {
          res = await fetch(url, {
            method,
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify(editingEstimateId
              ? { ...estimatePayload, items: formattedItems }
              : { estimate: estimatePayload, items: formattedItems }),
            signal: controller.signal,
          });
        } finally {
          window.clearTimeout(timeoutId);
        }
      }
      console.log(`[save] response received (${_ms()}ms)`, { status: res.status, ok: res.ok });

      if (res.ok) {
        const _bodyStart = performance.now();
        const savedEstimate = await res.json().catch(() => null);
        console.log(`[save] Estimate update API completed in ${_ms()}ms (body parse: ${Math.round(performance.now() - _bodyStart)}ms)`);
        const savedEstimateNumber = savedEstimate?.estimateNumber || estNumber;
        showSuccess(`Estimate "${savedEstimateNumber}" ${editingEstimateId ? "updated" : "saved"} successfully!`);
        setLastSavedAt(new Date());
        setIsDirty(false);

        // ── IMPORTANT: reset isSaving immediately so the button is no longer
        // stuck on "Saving…". Do NOT move any awaits between here and this call.
        setIsSaving(false);

        // Optimistically patch the local estimates array so the register
        // shows the updated amount the instant the form closes.
        if (editingEstimateId && savedEstimate) {
          setEstimates(prev =>
            prev.map(e => (e.id === editingEstimateId ? { ...e, ...savedEstimate } : e))
          );
        }

        setShowEstimateForm(false);
        setEstBillingProfileId("");
        setEditingEstimateId(null);
        setEstNumber("");
        setEstDate(todayYmd);
        setEstTitle("");
        setEstClientId("");
        setEstBrandId("");
        setEstStoreId("");
        setEstDescription("");
        setEstSubject("");
        setEstBillingTo("");
        setEstShippingTo("");
        setEstGstin("");
        setEstPan("");
        setEstStateCode("");
        setEstVendorCode("");
        setEstPacking("4");
        setEstImplementation("7");
        setEstTransport("0");
        setEstItems([]);
        setEstStoreOverrides({});

        // Navigate to register, then refresh estimates in background.
        if (editingEstimateId) {
          setLocation("/estimates");
          console.log(`[save] Navigated to estimate register (${_ms()}ms total)`);
        }

        // Background refresh — fire-and-forget, never blocks the UI.
        const _t1 = performance.now();
        fetchEstimates().then(
          () => console.log(`[save] Estimate register refetched in ${Math.round(performance.now() - _t1)}ms`),
          (err) => console.warn(`[save] fetchEstimates failed`, err),
        );
        fetchData().then(
          () => console.log(`[save] full refresh complete (${_ms()}ms)`),
          (err) => console.warn(`[save] full refresh failed`, err),
        );
        return; // prevent finally from calling setIsSaving(false) again (harmless but clean)
      } else {
        const body = await res.text().catch(() => "");
        console.warn(`[save] non-OK response`, res.status, body.slice(0, 200));
      }
    } catch (err: any) {
      if (err?.name === "AbortError") {
        console.error(`[save] request aborted after 25s timeout — server did not respond. DB may still have committed; reload to confirm.`);
        setMessage("Save timed out after 25 seconds. The estimate may have saved — please refresh to verify.");
        setTimeout(() => setMessage(""), 8000);
      } else {
        console.error(`[save] error after ${_ms()}ms`, err);
      }
    } finally {
      console.log(`[save] setIsSaving(false) — total ${_ms()}ms`);
      setIsSaving(false);
    }
  };

  // View estimate overlay detail
  const handleViewEstimateDetails = async (est: Estimate, initialTab: "estimate" | "overview" | "po" | "execution" | "documents" | "invoice" = "estimate") => {
    setShowPoModal(false);
    setShowDcModal(false);
    setShowDcPreviewModal(false);
    setSelectedDcForPreview(null);
    setExecutionDocumentViewer(null);
    if (initialTab === "estimate") {
      setEstimatePreviewMode("estimate");
      setProjectDashboardInitialTab("overview");
    } else {
      setEstimatePreviewMode("project");
      setProjectDashboardInitialTab(initialTab);
    }
    // Overlay the LIVE GST Profile data onto the estimate when one is linked,
    // so View Estimate / Print / Excel reflect the latest GST Profile edits
    // (e.g. the new structured multi-line address). The DB row keeps its
    // historical snapshot fields untouched.
    let liveEst: Estimate = est;
    // In Bolt mode skip the live GST profile overlay — the saved snapshot fields
    // on the estimate are used directly, which is always the safe fallback.
    if (!isBoltMode && (est as any).billingProfileId && (est as any).clientId) {
      try {
        const bpRes = await fetch(`/api/operations/clients/${(est as any).clientId}/billing-profiles`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (bpRes.ok) {
          const list: any[] = await bpRes.json();
          const bp = list.find(p => p.id === (est as any).billingProfileId);
          if (bp) {
            liveEst = {
              ...est,
              billingLegalNameSnapshot: bp.legalCompanyName,
              billingGstinSnapshot: bp.gstin,
              billingStateSnapshot: bp.state,
              billingStateCodeSnapshot: bp.stateCode,
              billingAddressSnapshot: bp.billingAddress,
              shippingAddressSnapshot: bp.shippingAddress || (est as any).shippingAddressSnapshot,
              billingTo: bp.legalCompanyName,
              gstin: bp.gstin,
              pan: bp.pan || (est as any).pan,
              stateCode: bp.stateCode,
            } as Estimate;
          }
        }
      } catch (err) {
        console.warn("Live GST profile overlay failed; falling back to snapshot:", err);
      }
    }
    setSelectedEstimate(liveEst);
    setSelectedEstimateItems([]);
    setSelectedChallans([]);
    setSelectedEstimateItemsLoading(true);
    try {
      if (isBoltMode) {
        const [items, challans] = await Promise.all([
          fetchEstimateItems(token, est.id),
          fetchDeliveryChallansForEstimate(token, est.id),
        ]);
        setSelectedEstimateItems(items as any[]);
        setSelectedChallans(challans as any[]);
      } else {
        const res = await fetch(`/api/operations/estimates/${est.id}/items`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) setSelectedEstimateItems(await res.json());

        const dRes = await fetch(`/api/operations/delivery-challans/estimate/${est.id}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (dRes.ok) setSelectedChallans(await dRes.json());
      }
    } catch (err) {
      console.error("Failed to load details:", err);
    } finally {
      setSelectedEstimateItemsLoading(false);
    }
  };

  useEffect(() => {
    if (focusTab !== "projects" || loading || selectedEstimate) return;
    const params = new URLSearchParams(window.location.search);
    const id = Number(params.get("estimateId"));
    if (!id) return;
    const target = estimates.find(e => e.id === id);
    if (target) handleViewEstimateDetails(target, "overview");
  }, [focusTab, loading, estimates, selectedEstimate]);

  const handleEditEstimate = async (est: Estimate) => {
    try {
      let items: any[] = [];
      let profiles: any[] = [];
      if (isBoltMode) {
        const [rawItems, rawProfiles] = await Promise.all([
          fetchEstimateItems(token, est.id),
          est.clientId ? apiFetchBillingProfiles(token, est.clientId) : Promise.resolve([]),
        ]);
        items = (rawItems as any[]) || [];
        profiles = (rawProfiles as any[]) || [];
      } else {
        const [itemsRes, profilesRes] = await Promise.all([
          fetch(`/api/operations/estimates/${est.id}/items`, {
            headers: { Authorization: `Bearer ${token}` }
          }),
          fetch(`/api/operations/clients/${est.clientId}/billing-profiles`, {
            headers: { Authorization: `Bearer ${token}` }
          }),
        ]);
        items = itemsRes.ok ? await itemsRes.json() : [];
        profiles = profilesRes.ok ? await profilesRes.json() : [];
      }
      setClientBillingProfilesList(profiles);

      const grouping = (est.storeGrouping as Record<string, any>) || {};
      const slToStore = new Map<number, string>();
      const orderedGroupingKeys = orderedStoreKeysFromItems(items, grouping);
      orderedGroupingKeys.forEach((sid) => {
        const group = grouping[sid];
        const itemSls = Array.isArray(group) ? group : ((group as any)?.itemSls || []);
        itemSls.forEach((sl: any) => slToStore.set(Number(sl), sid));
      });

      setEditingEstimateId(est.id);
      setEstNumber(est.estimateNumber);
      const safeDateStr = (v: any) => { try { const d = new Date(v); return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10); } catch { return null; } };
      setEstDate(safeDateStr(est.estimateDate) || safeDateStr(est.createdAt) || todayYmd);
      setEstClientId(String(est.clientId));
      setEstBrandId(String(est.brandId));
      setEstStoreId(String(est.storeId || ""));
      setEstTitle(est.title || "");
      setEstDescription(est.description || "");
      setEstFormat(normalizeFormatMode(est.clientFormat));
      setEstAbfrlProjectType((est.abfrlProjectType as "SELEX" | "CAPEX") || "SELEX");
      setEstSubject(est.subject || est.title || "");
      setEstBillingTo(est.billingTo || "");
      setEstShippingTo(est.shippingTo || "");
      setEstGstin(est.gstin || "");
      setEstPan(est.pan || "");
      setEstStateCode(est.billingStateCodeSnapshot || est.stateCode || "");
      setEstVendorCode(est.vendorCode || "");
      setEstGstType(est.gstType || "CGST+SGST");
      const settingsPacking = String(sellerProfile.defaultPacking ?? estPacking);
      const settingsImplementation = String(sellerProfile.defaultImplementation ?? estImplementation);
      const settingsLocalTransport = String(sellerProfile.defaultLocalTransport ?? estTransport);
      const settingsOutstationTransport = String(sellerProfile.defaultOutstationTransportRate ?? "");
      setEstPacking(settingsPacking);
      setEstImplementation(settingsImplementation);
      setEstTransport(settingsLocalTransport);
      setEstBillingProfileId(est.billingProfileId ? String(est.billingProfileId) : "");

      const overrides: Record<string, EstStoreOverride> = {};
      orderedGroupingKeys.forEach((sid) => {
        const group = grouping[sid];
        if (Array.isArray(group)) return;
        overrides[sid] = {
          packingPercent: group.packingPercent !== undefined ? String(group.packingPercent) : undefined,
          implementationPercent: group.implementationPercent !== undefined ? String(group.implementationPercent) : undefined,
          transportType: group.transportType === "outstation" ? "outstation" : "local",
          transportAmount: group.transportAmount !== undefined ? String(group.transportAmount) : undefined,
          transportKm: group.transportKm !== undefined ? String(group.transportKm) : undefined,
          transportRate: group.transportRate !== undefined ? String(group.transportRate) : undefined,
          transportDescription: group.transportDescription || "",
          storeName: group.storeName || "",
          storeLocation: group.storeLocation || "",
          storeCity: group.storeCity || "",
          storeState: group.storeState || "",
          storeAddress: group.storeAddress || "",
        };
      });
      setEstStoreOverrides(overrides);

      const hydratedItems = items.map((item, idx) => {
        const storeId = slToStore.get(Number(item.sl)) || String(est.storeId || "");
        const lineType = (item.lineType || "product") as EstimateItemInput["lineType"];
        const rawRate = item.rate != null ? String(item.rate) : "0";
        const repairedRate = lineType === "packing" && parseRateInput(rawRate) === 0
          ? settingsPercentRate(settingsPacking)
          : lineType === "installation" && parseRateInput(rawRate) === 0
            ? settingsPercentRate(settingsImplementation)
            : lineType === "transport" && String(item.unit || "").toLowerCase() === "km" && parseRateInput(rawRate) === 0
              ? settingsOutstationTransport
              : lineType === "transport" && parseRateInput(rawRate) === 0
                ? settingsLocalTransport
                : rawRate;
        const normalizedServiceLabel = lineType === "packing"
          ? serviceChargeLabel("Packing Charges", repairedRate)
          : lineType === "installation"
            ? serviceChargeLabel("Installation Charges", repairedRate)
            : lineType === "transport" && String(item.unit || "").toLowerCase() === "km" && (!item.description || item.description === "Outstation Transport - Destination")
              ? outstationTransportLabel(repairedRate)
              : lineType === "transport" && ["", "Transport Charges", "Transportation Charges", "Local Transport"].includes(String(item.description || item.itemName || ""))
                ? "Local Transportation"
              : undefined;
        return {
          sl: Number(item.sl) || idx + 1,
          productId: item.productId ? String(item.productId) : "",
          isStandard: item.isStandard !== false,
          hsn: item.hsn || "",
          materialCode: item.materialCode || "",
          materialCodeId: item.materialCodeId ?? null,
          materialDescription: item.materialDescription || "",
          itemName: normalizedServiceLabel || item.itemName || "",
          width: item.width != null ? String(item.width) : "",
          height: item.height != null ? String(item.height) : "",
          quantity: item.quantity != null ? String(item.quantity) : "1",
          unit: item.unit || "sqft",
          calculationType: item.calculationType || (item.width && item.height ? "sqft" : "fixed"),
          rate: isServiceLineType(lineType)
            ? formatServiceRateInput(repairedRate, (lineType === "packing" || lineType === "installation") ? "percentage" : item.calculationType)
            : (item.rate != null ? String(item.rate) : "0"),
          amount: item.totalPrice != null ? String(item.totalPrice) : "0",
          cgstPercent: item.cgstPercent != null ? String(item.cgstPercent) : "0",
          cgstAmount: item.cgstAmount != null ? String(item.cgstAmount) : "0",
          sgstPercent: item.sgstPercent != null ? String(item.sgstPercent) : "0",
          sgstAmount: item.sgstAmount != null ? String(item.sgstAmount) : "0",
          igstPercent: item.igstPercent != null ? String(item.igstPercent) : "0",
          igstAmount: item.igstAmount != null ? String(item.igstAmount) : "0",
          totalAmount: item.totalAmount != null ? String(item.totalAmount) : "0",
          storeId,
          storeSortOrder: item.storeSortOrder ?? idx + 1,
          rowSortOrder: item.rowSortOrder ?? (Number(item.sl) || idx + 1),
          description: normalizedServiceLabel || item.description || "",
          lineType,
          rateSource: "" as const,
        };
      });
      setEstItems(recalculateEstimateRows(hydratedItems));
      setShowEstimateForm(true);
      setSelectedEstimate(null);
    } catch (err) {
      console.error("Failed to load estimate for edit:", err);
    }
  };

  const handleDeleteEstimate = async (est: Estimate) => {
    if (!window.confirm(`Delete estimate ${est.estimateNumber}? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/operations/estimates/${est.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(body.message || "Failed to delete estimate.");
        return;
      }
      showSuccess(`Estimate ${est.estimateNumber} deleted.`);
      fetchData();
    } catch (err) {
      console.error("Failed to delete estimate:", err);
      alert("Failed to delete estimate.");
    }
  };

  const handleDuplicateEstimate = async (est: Estimate) => {
    if (!window.confirm(`Duplicate estimate ${est.estimateNumber}? A new draft copy will be created.`)) return;
    try {
      const res = await fetch(`/api/operations/estimates/${est.id}/duplicate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(body.message || "Failed to duplicate estimate.");
        return;
      }
      const newEst = await res.json();
      showSuccess(`Duplicated as ${newEst.estimateNumber}.`);
      fetchData();
    } catch (err) {
      console.error("Failed to duplicate estimate:", err);
      alert("Failed to duplicate estimate.");
    }
  };

  const handleUpdateStatus = async (estId: number, status: string) => {
    try {
      let res: Response;
      if (isBoltMode) {
        try {
          const data = await updateEstimate(token, estId, { status });
          res = new Response(JSON.stringify(data), { status: 200 });
        } catch (err: any) {
          res = new Response(JSON.stringify({ message: err.message }), { status: 500 });
        }
      } else {
        res = await fetch(`/api/operations/estimates/${estId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ status }),
        });
      }
      if (res.ok) {
        showSuccess(`Estimate status updated to ${status.replace("_", " ").toUpperCase()}`);
        const updated = await res.json();
        if (selectedEstimate && selectedEstimate.id === estId) {
          setSelectedEstimate(updated);
        }
        fetchData();
      }
    } catch (err) {
      console.error("Status update failed:", err);
    }
  };

  // PO Document upload handler
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, docType: string, customSetCallback: (path: string) => void) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    if (isBoltMode) { alert("Upload migration to Supabase Storage pending. File uploads are not yet available in Bolt preview mode."); return; }

    const formData = new FormData();
    formData.append("file", file);

    try {
      setUploadingDocType(docType);
      const res = await fetch("/api/operations/upload", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`
        },
        body: formData
      });

      if (res.ok) {
        const data = await res.json();
        customSetCallback(data.filePath);
        showSuccess(`File uploaded successfully to path: ${data.filePath}`);
      }
    } catch (err) {
      console.error("Upload failed:", err);
    } finally {
      setUploadingDocType(null);
    }
  };

  // Upload one or many image files (FileList or Blob[]) and append each as a
  // WccPhoto onto the current dcPhotos list. Used by the multi-upload <input>,
  // the drag/drop drop zone and the paste-from-clipboard handler in the WCC
  // builder.
  const handleMultiPhotoUpload = async (files: File[] | FileList | null) => {
    if (!files || files.length === 0) return;
    const arr = Array.from(files).filter(f => f.type.startsWith("image/"));
    if (arr.length === 0) return;
    if (isBoltMode) { alert("Upload migration to Supabase Storage pending. Photo uploads are not yet available in Bolt preview mode."); return; }
    setUploadingDocType("wcc_proof_multi");
    try {
      const startCount = dcPhotos.length;
      const uploaded: WccPhoto[] = [];
      for (let i = 0; i < arr.length; i++) {
        const fd = new FormData();
        fd.append("file", arr[i]);
        const res = await fetch("/api/operations/upload", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        });
        if (!res.ok) continue;
        const data = await res.json();
        // Tile new photos in a soft grid so they don't all stack on top of
        // each other. The user can drag/resize freely afterwards.
        const tileIndex = startCount + i;
        const cols = 2;
        const col = tileIndex % cols;
        const row = Math.floor(tileIndex / cols);
        uploaded.push({
          path: data.filePath,
          widthPct: 50,
          objectFit: "cover",
          objectPosition: "center center",
          caption: arr[i].name.replace(/\.[a-z0-9]+$/i, ""),
          xPct: 2 + col * 49,
          yPct: 2 + row * 49,
          wPct: 46,
          hPct: 46,
          z: tileIndex + 1,
        });
      }
      if (uploaded.length > 0) {
        setDcPhotos(prev => [...prev, ...uploaded]);
        showSuccess(`${uploaded.length} image${uploaded.length > 1 ? "s" : ""} uploaded.`);
      }
    } catch (err) {
      console.error("Multi-upload failed:", err);
    } finally {
      setUploadingDocType(null);
    }
  };

  const cloneWccPhotos = (photos: WccPhoto[]): WccPhoto[] => photos.map((photo) => ({ ...photo }));

  const reloadSelectedChallans = async () => {
    if (!selectedEstimate || !token) return;
    const dRes = await fetch(`/api/operations/delivery-challans/estimate/${selectedEstimate.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (dRes.ok) setSelectedChallans(await dRes.json());
  };

  const patchWccChallansInBatches = async (
    targetDcs: DeliveryChallan[],
    updatesFor: (dc: DeliveryChallan) => Record<string, any>,
  ) => {
    const batchSize = 6;
    let updated = 0;
    for (let i = 0; i < targetDcs.length; i += batchSize) {
      const batch = targetDcs.slice(i, i + batchSize);
      const results = await Promise.all(batch.map((dc) => fetch(`/api/operations/delivery-challans/${dc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(updatesFor(dc)),
      })));
      updated += results.filter((res) => res.ok).length;
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }
    await reloadSelectedChallans();
    fetchData();
    return updated;
  };

  const getCurrentStoreIdForWcc = () => {
    if (dcWccStoreScope) return Number(dcWccStoreScope);
    return selectedEstimate?.storeId || null;
  };

  const getWccTargets = (scope: "all" | "selected" | "remaining" | "current", selectedStoreIds: number[] = []) => {
    if (!selectedEstimate) return [];
    const currentStoreId = getCurrentStoreIdForWcc();
    return selectedChallans.filter((dc) => {
      if (dc.estimateId !== selectedEstimate.id || !isAblblFormat(dc.clientFormat)) return false;
      const storeId = Number(dc.metadata?.storeId || 0);
      if (scope === "all") return true;
      if (scope === "selected") return selectedStoreIds.includes(storeId);
      if (scope === "remaining") return currentStoreId ? storeId !== currentStoreId : true;
      return currentStoreId ? storeId === currentStoreId : false;
    });
  };

  const handleApplyCurrentPhotosToAllWccs = async () => {
    if (dcPhotos.length === 0) return alert("Add photos to the current WCC first.");
    const targets = getWccTargets("all");
    if (targets.length === 0) return alert("Generate WCC drafts first, then apply photos.");
    const hasExisting = targets.some((dc) => Array.isArray(dc.metadata?.photos) && dc.metadata.photos.length > 0);
    if (hasExisting && !confirm(`Replace existing photos in ${targets.length} WCCs?`)) return;
    const photos = cloneWccPhotos(dcPhotos);
    const count = await patchWccChallansInBatches(targets, (dc) => ({
      metadata: {
        ...(dc.metadata || {}),
        photos,
        visualBrief: photos[0]?.path || null,
      },
    }));
    showSuccess(`Applied current photos to ${count} WCC${count === 1 ? "" : "s"}.`);
  };

  const handleApplyCurrentPhotosToSelectedWccs = async (selectedStoreIds: number[]) => {
    if (dcPhotos.length === 0) return alert("Add photos to the current WCC first.");
    if (selectedStoreIds.length === 0) return alert("Select at least one store.");
    const targets = getWccTargets("selected", selectedStoreIds);
    if (targets.length === 0) return alert("No generated WCC drafts match the selected stores.");
    const hasExisting = targets.some((dc) => Array.isArray(dc.metadata?.photos) && dc.metadata.photos.length > 0);
    if (hasExisting && !confirm(`Replace existing photos in ${targets.length} selected WCCs?`)) return;
    const photos = cloneWccPhotos(dcPhotos);
    const count = await patchWccChallansInBatches(targets, (dc) => ({
      metadata: {
        ...(dc.metadata || {}),
        photos,
        visualBrief: photos[0]?.path || null,
      },
    }));
    showSuccess(`Applied current photos to ${count} selected WCC${count === 1 ? "" : "s"}.`);
  };

  const handleUseCurrentWccAsTemplateForRemainingStores = async () => {
    const targets = getWccTargets("remaining");
    if (targets.length === 0) return alert("No remaining generated WCC drafts found for this estimate.");
    const hasExisting = targets.some((dc) => Array.isArray(dc.metadata?.photos) && dc.metadata.photos.length > 0);
    if (hasExisting && !confirm(`Replace photos/checklist/remarks in ${targets.length} remaining WCCs? Store-specific fields will stay unchanged.`)) return;
    const photos = cloneWccPhotos(dcPhotos);
    const count = await patchWccChallansInBatches(targets, (dc) => ({
      remarks: dcRemarks || null,
      metadata: {
        ...(dc.metadata || {}),
        photos,
        visualBrief: photos[0]?.path || null,
        shortageNotes: wccShortageNotes || "",
        checklist: { ...wccChecklist },
      },
    }));
    showSuccess(`Template applied to ${count} remaining WCC${count === 1 ? "" : "s"}.`);
  };

  const handleBulkReplacePhoto = async (photoIndex: number, file: File, selectedStoreIds: number[] = []) => {
    if (!file.type.startsWith("image/")) return;
    if (isBoltMode) { alert("Upload migration to Supabase Storage pending."); return; }
    const fd = new FormData();
    fd.append("file", file);
    setUploadingDocType("wcc_proof_replace");
    try {
      const res = await fetch("/api/operations/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      if (!res.ok) return;
      const data = await res.json();
      const existing = dcPhotos[photoIndex];
      const replacement: WccPhoto = {
        ...(existing || {
          widthPct: 50,
          objectFit: "cover",
          objectPosition: "center center",
          caption: file.name.replace(/\.[a-z0-9]+$/i, ""),
          xPct: 2,
          yPct: 2,
          wPct: 46,
          hPct: 46,
          z: photoIndex + 1,
        }),
        path: data.filePath,
        caption: existing?.caption || file.name.replace(/\.[a-z0-9]+$/i, ""),
      };
      setDcPhotos((prev) => {
        const next = [...prev];
        next[photoIndex] = replacement;
        return next;
      });

      const choice = window.prompt(`Replace Photo #${photoIndex + 1} for: current, all, selected`, "current");
      if (!choice) return;
      const normalized = choice.trim().toLowerCase();
      const scope = normalized.startsWith("all") ? "all" : normalized.startsWith("selected") ? "selected" : "current";
      if (scope === "selected" && selectedStoreIds.length === 0) {
        alert("Select stores first, then replace for selected stores.");
        return;
      }
      const targets = getWccTargets(scope, selectedStoreIds);
      if (targets.length === 0) {
        showSuccess(`Photo #${photoIndex + 1} replaced on current unsaved WCC.`);
        return;
      }
      const count = await patchWccChallansInBatches(targets, (dc) => {
        const photos = Array.isArray(dc.metadata?.photos) ? cloneWccPhotos(dc.metadata.photos) : [];
        while (photos.length <= photoIndex) photos.push({ ...replacement });
        photos[photoIndex] = { ...(photos[photoIndex] || replacement), ...replacement };
        return {
          metadata: {
            ...(dc.metadata || {}),
            photos,
            visualBrief: photos[0]?.path || null,
          },
        };
      });
      showSuccess(`Photo #${photoIndex + 1} replaced in ${count} WCC${count === 1 ? "" : "s"}.`);
    } catch (err) {
      console.error("Bulk photo replace failed:", err);
    } finally {
      setUploadingDocType(null);
    }
  };

  const handlePoSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetEstimate = poWorkflowEstimate || selectedEstimate;
    if (!targetEstimate || !poNumber || !poAmount) return;

    try {
      const poPayload = {
        status: "po_received",
        poNumber,
        poDate: poDate || new Date().toISOString(),
        poAmount: Number(poAmount),
        poFilePath: poFileUrl || null,
        poRemarks: poRemarks || null,
      };
      let res: Response;
      if (isBoltMode) {
        try {
          const data = await updateEstimate(token, targetEstimate.id, poPayload);
          res = new Response(JSON.stringify(data), { status: 200 });
        } catch (err: any) {
          res = new Response(JSON.stringify({ message: err.message }), { status: 500 });
        }
      } else {
        res = await fetch(`/api/operations/estimates/${targetEstimate.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(poPayload),
        });
      }

      if (res.ok) {
        showSuccess("Purchase Order successfully uploaded and attached!");
        setShowPoModal(false);
        setPoNumber("");
        setPoDate("");
        setPoAmount("");
        setPoRemarks("");
        setPoFileUrl("");
        
        // Refresh detail view
        const updated = await res.json();
        setProjectDashboardInitialTab("po");
        setSelectedEstimate(updated);
        setPoWorkflowEstimate(null);
        fetchData();
      }
    } catch (err) {
      console.error("PO upload failed:", err);
    }
  };

  const openPoForEstimate = (estimate: Estimate) => {
    setProjectDashboardInitialTab("po");
    setSelectedEstimate(prev => prev?.id === estimate.id ? prev : null);
    setShowDcModal(false);
    setShowDcPreviewModal(false);
    setSelectedDcForPreview(null);
    setPoWorkflowEstimate(estimate);
    setPoNumber(estimate.poNumber || "");
    setPoDate(estimate.poDate ? new Date(estimate.poDate).toISOString().split("T")[0] : new Date().toISOString().split("T")[0]);
    setPoAmount(estimate.poAmount ? String(estimate.poAmount) : String(estimate.totalAmount || ""));
    setPoFileUrl(estimate.poFilePath || "");
    setPoRemarks(estimate.poRemarks || "");
    setShowPoModal(true);
  };

  const openPoViewerForEstimate = (estimate: Estimate) => {
    handleViewEstimateDetails(estimate, "po");
  };

  const openDocumentListForEstimate = (estimate: Estimate, type: "wcc" | "dc") => {
    handleViewEstimateDetails(estimate, "execution");
  };

  // Generate DC action
  const handleOpenDcModal = () => {
    if (!selectedEstimate) return;
    setShowPoModal(false);
    setShowDcPreviewModal(false);
    setSelectedDcForPreview(null);
    setEditingDcId(null);
    setDcNumberVal(`DC-${Date.now().toString().slice(-6)}`);
    setWccVisualBrief("");
    setWccShortageNotes("");
    setWccAuthPerson("");
    setDcPhotos([]);
    setDcFormat(isAblblFormat(selectedEstimate.clientFormat) ? "ABFRL" : "normal");
    setDcDeliveredBy("Sunrise logistics team");
    setDcReceivedBy("");
    setDcRemarks("");
    setDcWccStoreScope("");
    setShowDcModal(true);
  };

  // Open DC modal to create a new WCC for a specific store (from ProjectWorkspace drawer)
  const handleGenerateWccForStore = async (storeCode: string, storeId?: number | null) => {
    if (!selectedEstimate) return;
    setShowPoModal(false);
    setShowDcPreviewModal(false);
    setSelectedDcForPreview(null);
    setEditingDcId(null);
    setDcPhotos([]);
    setDcFormat(isAblblFormat(selectedEstimate.clientFormat) ? "ABFRL" : "normal");
    setDcDeliveredBy("Sunrise logistics team");
    setDcReceivedBy("");
    setDcRemarks("");
    setWccVisualBrief("");
    setWccShortageNotes("");
    setWccAuthPerson("");
    // Pre-select the store in the WCC modal
    setDcWccStoreScope(storeId ? String(storeId) : "");
    if (isBoltMode) {
      setDcNumberVal(`WCC-${Date.now().toString().slice(-6)}`);
    } else {
      try {
        const r = await fetch("/api/numbering/wcc/next", { headers: { Authorization: `Bearer ${token}` } });
        if (r.ok) {
          const { number } = await r.json();
          setDcNumberVal(number);
        } else {
          setDcNumberVal(`WCC-${Date.now().toString().slice(-6)}`);
        }
      } catch {
        setDcNumberVal(`WCC-${Date.now().toString().slice(-6)}`);
      }
    }
    setShowDcModal(true);
  };

  const openNewDcForEstimate = async (estimate: Estimate) => {
    setProjectDashboardInitialTab("execution");
    setSelectedEstimate(estimate);
    setShowPoModal(false);
    setShowDcPreviewModal(false);
    setSelectedDcForPreview(null);
    if (isBoltMode) {
      setDcNumberVal(`DC-${Date.now().toString().slice(-6)}`);
    } else {
      try {
        const r = await fetch(`/api/numbering/dc/next`, { headers: { Authorization: `Bearer ${token}` } });
        if (r.ok) {
          const { number } = await r.json();
          setDcNumberVal(number);
        } else {
          setDcNumberVal(`DC-${Date.now().toString().slice(-6)}`);
        }
      } catch {
        setDcNumberVal(`DC-${Date.now().toString().slice(-6)}`);
      }
    }
    setEditingDcId(null);
    setStandaloneDcEditor(true);
    setDcPhotos([]);
    setDcFormat(isAblblFormat(estimate.clientFormat) ? "ABFRL" : "normal");
    setDcDeliveredBy("Sunrise logistics team");
    setDcReceivedBy("");
    setDcRemarks("");
    setShowDcModal(true);
  };

  const findExistingWccForStore = (estimateId: number, storeCode: string | null | undefined, storeId?: number | null) => {
    return challans.find((dc) => {
      if (dc.estimateId !== estimateId || !isAblblFormat(dc.clientFormat)) return false;
      const meta = dc.metadata || {};
      if (storeCode && String(meta.storeCode || "").trim() === String(storeCode).trim()) return true;
      if (storeId && Number(meta.storeId || 0) === Number(storeId)) return true;
      return false;
    });
  };

  // Batch-generate one WCC per store group for an ABFRL multi-store estimate.
  // The user can then open each generated DC and edit pictures + signatures.
  const handleBatchGenerateWcc = async () => {
    if (!selectedEstimate || !token) return;
    const sg = (selectedEstimate.storeGrouping as Record<string, any>) || {};
    const sids = orderedStoreKeysFromItems(selectedEstimateItems, sg);
    if (sids.length === 0) {
      alert("This estimate has no per-store grouping — open the WCC builder normally.");
      return;
    }
    if (!confirm(`Generate ${sids.length} WCC certificates (one per store) for ${selectedEstimate.estimateNumber}?`)) return;

    // Find next sequential dc number once, then increment per loop
    let seqBase: string | null = null;
    if (!isBoltMode) {
      try {
        const r = await fetch(`/api/numbering/dc/next`, { headers: { Authorization: `Bearer ${token}` } });
        if (r.ok) seqBase = (await r.json()).number;
      } catch {/* fall through to timestamp scheme */}
    }

    let createdCount = 0;
    for (let i = 0; i < sids.length; i++) {
      const sid = sids[i];
      const tStore = stores.find(s => s.id === Number(sid));
      const existing = findExistingWccForStore(selectedEstimate.id, tStore?.storeCode, tStore?.id);
      if (existing) continue;
      const group = sg[sid] || [];
      const itemSls: number[] = Array.isArray(group) ? group : (group.itemSls || []);
      const storeItems = selectedEstimateItems
        .filter(it => itemSls.includes(it.sl || 0))
        .map(it => ({
          sl: it.sl, itemName: it.itemName, quantity: it.quantity, unit: it.unit,
          width: it.width, height: it.height, rate: it.rate, totalAmount: it.totalAmount,
        }));
      if (storeItems.length === 0) continue;
      const dcNumber = seqBase
        ? (sids.length === 1 ? seqBase : `${seqBase}-${tStore?.storeCode || (i + 1)}`)
        : `DC-${Date.now().toString().slice(-6)}-${i + 1}`;
      const payload = {
        dcNumber,
        estimateId: selectedEstimate.id,
        status: "draft",
        items: storeItems,
        deliveredBy: null,
        receivedBy: null,
        remarks: null,
        clientFormat: "ABFRL",
        storeCode: tStore?.storeCode || null,
        metadata: {
          storeCode: tStore?.storeCode || "",
          storeId: tStore?.id || null,
          storeName: tStore?.name || "",
          city: tStore?.city || "",
          state: tStore?.state || "",
          photos: [],
          shortageNotes: "",
          authPerson: tStore?.contactPerson || "",
          checklist: { window: true, inStore: false, nso: false, repairing: false, materialTransfer: false },
        },
      };
      let dcRes: Response;
      if (isBoltMode) {
        try {
          const data = await createDeliveryChallan(token, payload);
          dcRes = new Response(JSON.stringify(data), { status: 200 });
        } catch (err: any) {
          dcRes = new Response(JSON.stringify({ message: err.message }), { status: 500 });
        }
      } else {
        dcRes = await fetch("/api/operations/delivery-challans", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(payload),
        });
      }
      if (dcRes.ok) createdCount++;
    }
    showSuccess(`Generated ${createdCount} of ${sids.length} WCC drafts.`);
    // refresh data
    const dRes = await fetch(`/api/operations/delivery-challans/estimate/${selectedEstimate.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (dRes.ok) setSelectedChallans(await dRes.json());
    fetchData();
  };

  const handleDcSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEstimate || !dcNumberVal) return;

    try {
      const scopedStoreId = dcWccStoreScope ? Number(dcWccStoreScope) : selectedEstimate.storeId;
      const scopedStore = stores.find(s => s.id === scopedStoreId);
      if (isAblblFormat(dcFormat) && !editingDcId) {
        const existing = findExistingWccForStore(selectedEstimate.id, scopedStore?.storeCode, scopedStore?.id);
        if (existing) {
          await openDcForEdit(existing, "WCC already exists for this store");
          return;
        }
      }

      const formattedItems = selectedEstimateItems.map(item => ({
        sl: item.sl,
        itemName: item.itemName,
        quantity: item.quantity,
        unit: item.unit,
        width: item.width,
        height: item.height,
        rate: item.rate,
        totalAmount: item.totalAmount
      }));

      const payload = {
        dcNumber: dcNumberVal,
        estimateId: selectedEstimate.id,
        status: "draft",
        items: formattedItems,
        deliveredBy: dcDeliveredBy || null,
        receivedBy: dcReceivedBy || null,
        remarks: dcRemarks || null,
        clientFormat: dcFormat,
        metadata: {
          visualBrief: wccVisualBrief || (dcPhotos.length > 0 ? dcPhotos[0].path : null),
          shortageNotes: wccShortageNotes || null,
          authPerson: wccAuthPerson || null,
          photos: dcPhotos,
          storeCode: scopedStore?.storeCode || "LP-01",
          storeId: scopedStore?.id || null,
          storeName: scopedStore?.name || "",
          city: scopedStore?.city || "",
          state: scopedStore?.state || "",
          checklist: wccChecklist,
        }
      };

      let res: Response;
      if (isBoltMode) {
        try {
          const data = editingDcId
            ? await updateDeliveryChallan(token, editingDcId, payload)
            : await createDeliveryChallan(token, payload);
          res = new Response(JSON.stringify(data), { status: 200 });
        } catch (err: any) {
          res = new Response(JSON.stringify({ message: err.message }), { status: 500 });
        }
      } else {
        res = await fetch(editingDcId ? `/api/operations/delivery-challans/${editingDcId}` : "/api/operations/delivery-challans", {
          method: editingDcId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(payload),
        });
      }

      if (res.ok) {
        showSuccess(`WCC "${dcNumberVal}" ${editingDcId ? "updated" : "created"} successfully!`);
        setShowDcModal(false);
        setEditingDcId(null);
        
        // Reload challans
        const dRes = await fetch(`/api/operations/delivery-challans/estimate/${selectedEstimate.id}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (dRes.ok) setSelectedChallans(await dRes.json());
        fetchData();
      }
    } catch (err) {
      console.error("DC creation failed:", err);
    }
  };

  const handleUpdateDcFiles = async (dcId: number, field: string, filePath: string) => {
    try {
      const res = await fetch(`/api/operations/delivery-challans/${dcId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ [field]: filePath })
      });
      if (res.ok) {
        showSuccess("Proof document linked successfully to Delivery Challan!");
        
        // Reload details
        if (selectedEstimate) {
          const dRes = await fetch(`/api/operations/delivery-challans/estimate/${selectedEstimate.id}`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          if (dRes.ok) setSelectedChallans(await dRes.json());
        }
        fetchData();
      }
    } catch (err) {
      console.error("Proof update failed:", err);
    }
  };

  const loadEstimateContextForDc = async (dc: DeliveryChallan) => {
    let est = selectedEstimate?.id === dc.estimateId
      ? selectedEstimate
      : estimates.find((row) => row.id === dc.estimateId) || null;
    let items = selectedEstimate?.id === dc.estimateId && selectedEstimateItems.length > 0
      ? selectedEstimateItems
      : [];

    if (!est) return null;
    if (items.length === 0) {
      const itemRes = await fetch(`/api/operations/estimates/${dc.estimateId}/items`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (itemRes.ok) items = await itemRes.json();
    }
    if (est) setSelectedEstimate(est);
    setSelectedEstimateItems(items);
    const dRes = await fetch(`/api/operations/delivery-challans/estimate/${dc.estimateId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (dRes.ok) setSelectedChallans(await dRes.json());
    return est;
  };

  const openDcForEdit = async (dc: DeliveryChallan, message?: string) => {
    const isStandaloneWorkflow = selectedEstimate?.id !== dc.estimateId;
    const est = await loadEstimateContextForDc(dc);
    if (!est) return;
    const meta = dc.metadata || {};
    setSelectedChallans((prev) => prev.some((row) => row.id === dc.id) ? prev : [dc, ...prev]);
    setEditingDcId(dc.id);
    setDcNumberVal(dc.dcNumber || "");
    setWccVisualBrief(meta.visualBrief || "");
    setWccShortageNotes(meta.shortageNotes || "");
    setWccAuthPerson(meta.authPerson || "");
    setDcPhotos(Array.isArray(meta.photos) ? meta.photos : []);
    setWccChecklist(meta.checklist || { window: true, inStore: false, nso: false, repairing: false, materialTransfer: false });
    setDcFormat(dc.clientFormat || (isAblblFormat(est.clientFormat) ? "ABFRL" : "normal"));
    setDcDeliveredBy(dc.deliveredBy || "Sunrise logistics team");
    setDcReceivedBy(dc.receivedBy || "");
    setDcRemarks(dc.remarks || "");
    setDcWccStoreScope(meta.storeId ? String(meta.storeId) : "");
    setShowDcPreviewModal(false);
    setSelectedDcForPreview(null);
    setShowPoModal(false);
    setWccPrintMode("current");
    setStandaloneDcEditor(isStandaloneWorkflow);
    setShowDcModal(true);
    if (message) showSuccess(message);
  };

  const openWccPreview = async (dc: DeliveryChallan) => {
    const keepProjectDashboardOwner = selectedEstimate?.id === dc.estimateId && !standaloneDcEditor;
    await loadEstimateContextForDc(dc);
    setWccPrintMode("current");
    setShowPoModal(false);
    setStandaloneDcEditor(false);
    if (!keepProjectDashboardOwner) setSelectedEstimate(null);
    setShowDcModal(false);
    setSelectedDcForPreview(dc);
    setShowDcPreviewModal(true);
  };

  const printWcc = async (dc: DeliveryChallan) => {
    setWccPrintMode("current");
    await openWccPreview(dc);
    window.setTimeout(() => window.print(), 100);
  };

  const deleteDeliveryChallanForPreview = async (dc: DeliveryChallan) => {
    if (!token) return;
    if (!confirm(`Delete ${isAblblFormat(dc.clientFormat) ? "WCC" : "Delivery Challan"} ${dc.dcNumber}?`)) return;
    const res = await fetch(`/api/operations/delivery-challans/${dc.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        status: "deleted",
        metadata: { ...(dc.metadata || {}), deleted: true, deletedAt: new Date().toISOString() },
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(body.message || "Delete failed");
      return;
    }
    showSuccess("Document deleted.");
    if (selectedEstimate) {
      const dRes = await fetch(`/api/operations/delivery-challans/estimate/${selectedEstimate.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (dRes.ok) setSelectedChallans(await dRes.json());
    }
    fetchData();
  };

  const executionDocFileName = (doc: any) =>
    doc?.originalFileName || String(doc?.filePath || "").split("/").pop() || "Document";

  const executionDocIsImage = (doc: any) =>
    Boolean((doc?.mimeType && doc.mimeType.startsWith("image/")) || /\.(png|jpe?g|gif|webp)$/i.test(executionDocFileName(doc)));

  const executionDocIsPdf = (doc: any) =>
    Boolean(doc?.mimeType === "application/pdf" || /\.pdf$/i.test(executionDocFileName(doc)));

  const openExecutionDocumentViewerFromOwner = (doc: any) => {
    setExecutionDocumentViewer(doc);
    setExecutionDocumentVersions([]);
    setShowExecutionDocumentHistory(false);
  };

  const loadExecutionDocumentVersionsFromOwner = async (doc: any) => {
    if (!doc?.id || !token) return;
    const res = await fetch(`/api/operations/execution-documents/${doc.id}/versions`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      setExecutionDocumentVersions(await res.json());
      setShowExecutionDocumentHistory(true);
    }
  };

  const openExecutionDocumentHistoryFromOwner = async (doc: any) => {
    setExecutionDocumentViewer(doc);
    setExecutionDocumentVersions([]);
    setShowExecutionDocumentHistory(true);
    await loadExecutionDocumentVersionsFromOwner(doc);
  };

  const replaceExecutionDocumentFromOwner = async (doc: any, file: File) => {
    if (isBoltMode) { alert("Upload migration to Supabase Storage pending."); return; }
    const formData = new FormData();
    formData.append("file", file);
    const uploadRes = await fetch("/api/operations/upload", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    if (!uploadRes.ok) return;
    const uploaded = await uploadRes.json();
    const res = await fetch(`/api/operations/execution-documents/${doc.id}/replace`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        filePath: uploaded.filePath,
        originalFileName: uploaded.fileName || file.name,
        mimeType: file.type || null,
        fileSize: uploaded.fileSize || file.size || null,
      }),
    });
    if (res.ok) {
      setExecutionDocumentViewer(await res.json());
      setExecutionDocumentVersions([]);
      setShowExecutionDocumentHistory(false);
      fetchData();
    }
  };

  const deleteExecutionDocumentFromOwner = async (doc: any) => {
    console.log("[doc-delete] handler entered", { id: doc?.id, type: doc?.documentType });
    if (!doc?.id) {
      console.error("[doc-delete] no doc.id — abort");
      return;
    }
    if (!confirm(`Delete ${executionDocFileName(doc)}?`)) {
      console.log("[doc-delete] user cancelled");
      return;
    }
    console.log("[doc-delete] sending DELETE", `/api/operations/execution-documents/${doc.id}`);
    const res = await fetch(`/api/operations/execution-documents/${doc.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    console.log("[doc-delete] response", res.status, res.statusText);
    if (res.ok) {
      setExecutionDocumentViewer(null);
      setExecutionDocumentVersions([]);
      setShowExecutionDocumentHistory(false);
      console.log("[doc-delete] success — refreshing data");
      await fetchData();
      console.log("[doc-delete] refresh complete");
    } else {
      const body = await res.text().catch(() => "");
      console.error("[doc-delete] server rejected:", res.status, body);
      alert(`Delete failed (${res.status}). ${body || "See console for details."}`);
    }
  };

  const activeWccsForEditor = selectedChallans
    .concat(challans.filter(dc => selectedChallans.every(existing => existing.id !== dc.id) && dc.estimateId === (editingDcId ? (challans.find(c => c.id === editingDcId)?.estimateId) : selectedDcForPreview?.estimateId)))
    .filter(dc => isAblblFormat(dc.clientFormat) && dc.status !== "deleted" && !dc.metadata?.deleted)
    .sort((a, b) => String(a.metadata?.storeCode || "").localeCompare(String(b.metadata?.storeCode || "")) || (a.id || 0) - (b.id || 0));

  const navigateWccEditor = async (dcId: number) => {
    const next = activeWccsForEditor.find(dc => dc.id === dcId) || challans.find(dc => dc.id === dcId);
    if (next) await openDcForEdit(next);
  };

  const printAllWccs = () => {
    if (activeWccsForEditor.length === 0) return;
    setWccPrintMode("all");
    window.setTimeout(() => window.print(), 100);
  };

  const handleCreateInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEstForPacket) return;
    const client = clients.find(c => c.id === selectedEstForPacket.clientId);
    const payload = {
      invoiceNumber: invoiceNumberInput,
      type: "sales",
      partyName: selectedEstForPacket.billingLegalNameSnapshot || client?.name || "",
      amount: selectedEstForPacket.subtotal,
      taxAmount: selectedEstForPacket.taxAmount,
      totalAmount: selectedEstForPacket.totalAmount,
      date: invoiceDateInput,
      dueDate: invoiceDueDateInput,
      status: "unpaid",
      estimateId: selectedEstForPacket.id,
      clientId: selectedEstForPacket.clientId,
      paidAmount: 0,
      balanceAmount: selectedEstForPacket.totalAmount,
      packetSettings: { checkedPages: packetCheckedPages, pageOrder: packetPageOrder },
      remarks: invoiceRemarksInput || null,
    };
    try {
      let ok = false;
      if (isBoltMode) {
        await createInvoice(token, payload);
        ok = true;
      } else {
        const res = await fetch("/api/finance/invoices", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const err = await res.json();
          setMessage("Error: " + (err.message || "Invoice creation failed"));
        } else {
          ok = true;
        }
      }
      if (ok) {
        setShowPacketBuilder(false);
        setSelectedEstForPacket(null);
        setInvoiceNumberInput("");
        setInvoiceRemarksInput("");
        await fetchLedgerData();
        setActiveTab("invoices_ledger");
        setInvoiceSubTab("ledger");
      }
    } catch (err: any) {
      setMessage("Error: " + (err.message || "Invoice creation failed"));
      console.error(err);
    }
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    const clientId = Number(paymentClientId);
    const client = clients.find(c => c.id === clientId);
    const outstandingInvoices = invoices.filter(
      inv => inv.clientId === clientId && inv.status !== "paid"
    );
    const allocatedList = outstandingInvoices
      .filter(inv => paymentAllocations[inv.id] > 0)
      .map(inv => ({ invoiceId: inv.id, amount: paymentAllocations[inv.id] }));

    const payload = {
      voucherNumber: `RV/${new Date().getFullYear()}/${String(Date.now()).slice(-5)}`,
      type: "receipt",
      partyName: client?.name || "",
      date: paymentDate,
      amount: Number(paymentAmount),
      method: paymentMethod,
      description: paymentRemarks || null,
      clientId,
      allocatedInvoices: allocatedList,
    };
    try {
      let ok = false;
      let paymentErrMsg = "Payment recording failed";
      if (isBoltMode) {
        await createPayment(token, payload);
        ok = true;
      } else {
        const res = await fetch("/api/finance/payments", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(payload),
        });
        if (res.ok && allocatedList.length > 0) {
          await fetch("/api/finance/payments/allocate", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ allocations: allocatedList }),
          });
        }
        ok = res.ok;
        if (!ok) {
          const errBody = await res.json().catch(() => ({}));
          paymentErrMsg = errBody.message || "Payment recording failed";
        }
      }
      if (ok) {
        setShowRecordPayment(false);
        setPaymentClientId("");
        setPaymentAmount("");
        setPaymentRemarks("");
        setPaymentAllocations({});
        await fetchLedgerData();
      } else {
        setMessage("Error: " + paymentErrMsg);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchClientStatement = async (clientId: number) => {
    setStatementLoading(true);
    setActiveLedgerClientId(clientId);
    try {
      const data = await fetchClientLedger(token, clientId);
      setClientStatement((data as any)?.statement || []);
    } catch (err) {
      console.error(err);
    } finally {
      setStatementLoading(false);
    }
  };

  const formatCurrency = (val: number) => {
    return "₹" + val.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const renderProjectsPage = () => {
    const visibleProjects = estimates.filter(e => e.status !== "draft" || e.poNumber || challans.some(c => c.estimateId === e.id));
    const latestActivity = (estimate: Estimate, estChallans: DeliveryChallan[], estInvoices: Invoice[]) => {
      const dates = [
        estimate.createdAt,
        estimate.poDate,
        ...estChallans.map((dc: any) => dc.createdAt || dc.deliveryDate),
        ...estInvoices.map((inv: any) => inv.createdAt || inv.invoiceDate),
      ].filter(Boolean).map(value => new Date(String(value)).getTime()).filter(Number.isFinite);
      if (!dates.length) return "-";
      return new Date(Math.max(...dates)).toLocaleDateString("en-GB");
    };
    return (
      <div data-qa="projects-page" className="space-y-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-orange-600">Project List</p>
              <h2 className="text-lg font-black text-slate-900">Operational Projects</h2>
              <p className="text-xs text-slate-500 mt-1">Open a full-page project workspace for PO, execution, documents, and invoice readiness.</p>
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2"><span className="block text-slate-400 font-black uppercase">Projects</span><b>{visibleProjects.length}</b></div>
              <div className="rounded border border-blue-200 bg-blue-50 px-3 py-2"><span className="block text-blue-500 font-black uppercase">WCC</span><b>{challans.filter(c => c.status !== "deleted" && isAblblFormat(c.clientFormat)).length}</b></div>
              <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2"><span className="block text-emerald-600 font-black uppercase">Invoices</span><b>{invoices.length}</b></div>
            </div>
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-black">Project</th>
                  <th className="px-3 py-2 font-black">Estimate No</th>
                  <th className="px-3 py-2 font-black">Client</th>
                  <th className="px-3 py-2 font-black">PO Status</th>
                  <th className="px-3 py-2 font-black text-center">Stores</th>
                  <th className="px-3 py-2 font-black">WCC Progress</th>
                  <th className="px-3 py-2 font-black">Photos</th>
                  <th className="px-3 py-2 font-black">Invoice Status</th>
                  <th className="px-3 py-2 font-black">Last Activity</th>
                  <th className="px-2 py-2 font-black text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleProjects.map((estimate) => {
                  const client = clients.find(c => c.id === estimate.clientId);
                  const projectChallans = challans.filter(c => c.estimateId === estimate.id && c.status !== "deleted" && !c.metadata?.deleted);
                  const projectInvoices = invoices.filter((inv: any) => inv.estimateId === estimate.id);
                  const storeCount = Object.keys((estimate.storeGrouping as Record<string, any>) || {}).length || (estimate.storeId ? 1 : 0);
                  const wccCount = projectChallans.filter(dc => isAblblFormat(dc.clientFormat)).length;
                  const photoCount = projectChallans.reduce((sum, dc: any) => sum + (Array.isArray(dc.metadata?.photos) ? dc.metadata.photos.length : (dc.photoPath ? 1 : 0)), 0);
                  const invoiceStatus = projectInvoices[0]?.status || "Not Generated";
                  return (
                    <tr key={estimate.id} className="hover:bg-slate-50 transition">
                      <td className="px-3 py-2">
                        <div className="font-black text-slate-900">{estimate.title}</div>
                        <div className="text-[10px] text-slate-400">{brands.find(b => b.id === estimate.brandId)?.name || "Brand"}</div>
                      </td>
                      <td className="px-3 py-2 font-mono font-black text-orange-600">{estimate.estimateNumber}</td>
                      <td className="px-3 py-2 text-slate-700">{client?.name || `Client #${estimate.clientId}`}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex px-2 py-1 rounded-full border text-[10px] font-black uppercase ${estimate.poNumber ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-amber-50 text-amber-700 border-amber-200"}`}>
                          {estimate.poNumber ? "Received" : "Pending"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center font-black text-slate-800">{storeCount}</td>
                      <td className="px-3 py-2 font-black text-blue-700">{wccCount}/{storeCount || 1}</td>
                      <td className="px-3 py-2 font-black text-orange-700">{photoCount}</td>
                      <td className="px-3 py-2">
                        <span className="inline-flex px-2 py-1 rounded-full border border-slate-200 bg-slate-50 text-slate-700 text-[10px] font-black uppercase">{String(invoiceStatus).replace(/_/g, " ")}</span>
                      </td>
                      <td className="px-3 py-2 text-slate-500 font-mono">{latestActivity(estimate, projectChallans, projectInvoices as any)}</td>
                      <td className="px-2 py-2 text-right">
                        <button type="button" onClick={() => handleViewEstimateDetails(estimate, "overview")} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-slate-900 text-white font-black hover:bg-slate-800 transition whitespace-nowrap">
                          <FolderOpen className="w-3.5 h-3.5" />
                          Open Project
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {visibleProjects.length === 0 && (
                  <tr><td colSpan={10} className="px-3 py-10 text-center text-slate-400">No projects available yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className={`operations-print-root ${selectedEstimate ? "has-estimate-preview" : ""} space-y-4 ${focusTab ? "max-w-[1400px]" : "max-w-7xl"} mx-auto px-2 sm:px-4`}>
      {/* Title Header — hub mode shows the Estimate-to-Delivery hub chrome;
          focus mode (Bolt-style dedicated pages) renders just a compact title. */}
      {focusTab ? (
        <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-slate-200 pb-2 gap-2">
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">{focusTitle || pageTitle}</h1>
            {focusSubtitle && <p className="text-slate-500 text-xs mt-0.5">{focusSubtitle}</p>}
          </div>
        </div>
      ) : (
        <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-slate-200 pb-4 gap-4">
          <div>
            <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">{pageTitle}</h1>
            <p className="text-slate-500 text-sm mt-1">{pageSubtitle}</p>
          </div>
          {!isMasterContext && <div className="flex gap-2">
            <button
              onClick={() => setActiveTab("estimates")}
              className={`px-4 py-2 text-xs font-bold rounded-lg transition border ${activeTab === "estimates" ? "bg-orange-50 text-orange-600 border-orange-200" : "bg-white text-slate-600 border-slate-200"}`}
            >
              Workflow Console
            </button>
          </div>}
        </div>
      )}

      {message && (
        <div className="p-3 bg-green-50 border border-green-200 text-green-800 text-xs rounded-lg font-medium flex items-center gap-2 animate-pulse">
          <CheckCircle className="w-4 h-4 text-green-600" />
          {message}
        </div>
      )}

      {activeTab === "projects" && !selectedEstimate && renderProjectsPage()}

      {/* Primary Tab Navigation — hidden in focus mode */}
      {!focusTab && !isMasterContext && <div className="flex border-b border-slate-200 overflow-x-auto pb-1 whitespace-nowrap bg-white p-2 rounded-xl shadow-sm gap-2">
        <button
          onClick={() => { setActiveTab("estimates"); setMessage(""); }}
          className={`pb-2 px-6 py-2 text-xs font-bold border-b-2 transition flex items-center gap-2 ${activeTab === "estimates" ? "border-orange-500 text-orange-600" : "border-transparent text-slate-500 hover:text-slate-800"}`}
        >
          <FileText className="w-4 h-4" />
          Estimates & Builder ({estimates.length})
        </button>
        <button
          onClick={() => { setActiveTab("challans"); setMessage(""); }}
          className={`pb-2 px-6 py-2 text-xs font-bold border-b-2 transition flex items-center gap-2 ${activeTab === "challans" ? "border-orange-500 text-orange-600" : "border-transparent text-slate-500 hover:text-slate-800"}`}
        >
          <Briefcase className="w-4 h-4" />
          Delivery Challans & WCC ({challans.length})
        </button>
        <button
          onClick={() => { setActiveTab("clients"); setMessage(""); }}
          className={`pb-2 px-6 py-2 text-xs font-bold border-b-2 transition flex items-center gap-2 ${activeTab === "clients" ? "border-orange-500 text-orange-600" : "border-transparent text-slate-500 hover:text-slate-800"}`}
        >
          <Building2 className="w-4 h-4" />
          Clients Registry ({clients.length})
        </button>
        <button
          onClick={() => { setActiveTab("brands"); setMessage(""); }}
          className={`pb-2 px-6 py-2 text-xs font-bold border-b-2 transition flex items-center gap-2 ${activeTab === "brands" ? "border-orange-500 text-orange-600" : "border-transparent text-slate-500 hover:text-slate-800"}`}
        >
          <Tag className="w-4 h-4" />
          Brands Register ({brands.length})
        </button>
        <button
          onClick={() => { setActiveTab("stores"); setMessage(""); }}
          className={`pb-2 px-6 py-2 text-xs font-bold border-b-2 transition flex items-center gap-2 ${activeTab === "stores" ? "border-orange-500 text-orange-600" : "border-transparent text-slate-500 hover:text-slate-800"}`}
        >
          <MapPin className="w-4 h-4" />
          Store Sites ({stores.length})
        </button>
        <button
          onClick={() => { setActiveTab("products"); setMessage(""); }}
          className={`pb-2 px-6 py-2 text-xs font-bold border-b-2 transition flex items-center gap-2 ${activeTab === "products" ? "border-orange-500 text-orange-600" : "border-transparent text-slate-500 hover:text-slate-800"}`}
        >
          <Package className="w-4 h-4" />
          Signage Catalog ({products.length})
        </button>
        <button
          onClick={() => { setActiveTab("master_data"); setMessage(""); }}
          className={`pb-2 px-6 py-2 text-xs font-bold border-b-2 transition flex items-center gap-2 ${activeTab === "master_data" ? "border-orange-500 text-orange-600" : "border-transparent text-slate-500 hover:text-slate-800"}`}
        >
          <Database className="w-4 h-4" />
          Master Data Manager
        </button>
        <button
          onClick={() => { setActiveTab("invoices_ledger"); setMessage(""); }}
          className={`pb-2 px-6 py-2 text-xs font-bold border-b-2 transition flex items-center gap-2 ${activeTab === "invoices_ledger" ? "border-orange-500 text-orange-600" : "border-transparent text-slate-500 hover:text-slate-800"}`}
        >
          <Scale className="w-4 h-4" />
          Invoices & Ledgers
        </button>
        <button
          onClick={() => { setActiveTab("project_tracker"); setMessage(""); }}
          className={`pb-2 px-6 py-2 text-xs font-bold border-b-2 transition flex items-center gap-2 ${activeTab === "project_tracker" ? "border-orange-500 text-orange-600" : "border-transparent text-slate-500 hover:text-slate-800"}`}
        >
          <Clock className="w-4 h-4" />
          Project Tracker
        </button>
      </div>}

      {/* ======================================================== */}
      {/* 1. ESTIMATES & BUILDER TAB */}
      {/* ======================================================== */}
      {activeTab === "estimates" && (
        <EstimateBuilder
          {...{
            showEstimateForm,
            estimateSearch,
            setEstimateSearch,
            estimateStatusFilter,
            setEstimateStatusFilter,
            token,
            setEstNumber,
            setShowEstimateForm,
            estimates,
            clients,
            brands,
            challans,
            invoices,
            handleViewEstimateDetails,
            handleEditEstimate,
            handleDeleteEstimate,
            handleDuplicateEstimate,
            setShowPoModal,
            openPoForEstimate,
            openPoViewerForEstimate,
            openDocumentListForEstimate,
            openNewDcForEstimate,
            setSelectedEstimate,
            setDcNumberVal,
            setDcPhotos,
            setDcFormat,
            setDcDeliveredBy,
            setDcReceivedBy,
            setDcRemarks,
            setShowDcModal,
            openInvoiceEditor,
            setActiveTab,
            setInvoiceSubTab,
            showSuccess,
            fetchData,
            handleCreateEstimate,
            estClientId,
            estFormat,
            setEstFormat,
            estSubject,
            estNumber,
            estDate,
            setEstDate,
            editingEstimateId,
            setEditingEstimateId,
            sellerProfile,
            estTitle,
            setEstTitle,
            estItems,
            setEstItems: setOrderedEstItems,
            recalculateEstimateRows,
            stores,
            blankRowForStore,
            estGstType,
            setEstStoreOverrides,
            estStoreOverrides,
            estPacking,
            estImplementation,
            estAbfrlProjectType,
            setEstSubject,
            handleClientSelectChange,
            estBrandId,
            setEstBrandId,
            setEstAbfrlProjectType,
            setEstGstType,
            clientBillingProfilesList,
            estBillingProfileId,
            setEstBillingProfileId,
            setEstBillingTo,
            setEstGstin,
            setEstStateCode,
            setEstPan,
            estBillingTo,
            estShippingTo,
            setEstShippingTo,
            estGstin,
            estPan,
            estStateCode,
            estVendorCode,
            setEstVendorCode,
            setPasteModalStoreId,
            setPasteText,
            setPasteError,
            pastePreviewRows,
            setPastePreviewRows,
            products,
            setProducts,
            setClients,
            userRole: user?.role || "",
            handleProductSelectChange,
            handleEstimateItemChange,
            removeEstimateItem,
            deleteEstimateItems,
            pasteModalStoreId,
            pasteText,
            pasteError,
            previewExcelPaste,
            applyExcelPaste,
            copyItemsFromStore,
            addPackingItem,
            addInstallationItem,
            addTransportItem,
            copyEstimateItemToClipboard,
            pasteRowBelow,
            duplicateEstimateItem,
            rowClipboard,
            isSaving,
            isDirty,
            lastSavedAt,
            setMessage
          }}
        />
      )}

      {/* ======================================================== */}
      {/* 2. DELIVERY CHALLANS / WCC TAB */}
      {/* ======================================================== */}
      {activeTab === "challans" && (
        <DeliveryChallanPanel
          challans={challans}
          estimates={estimates}
          clients={clients}
          stores={stores}
          onEdit={openDcForEdit}
          onPreview={openWccPreview}
          onPrint={printWcc}
          handleFileUpload={handleFileUpload}
          handleUpdateDcFiles={handleUpdateDcFiles}
          token={token}
          reload={fetchData}
        />
      )}

      {/* ======================================================== */}
      {/* 3. CLIENTS TAB */}
      {/* ======================================================== */}
      {activeTab === "clients" && (
        <ClientsPanel
          clients={clients}
          token={token}
          reload={fetchData}
          showClientForm={showClientForm}
          setShowClientForm={setShowClientForm}
          clientName={clientName}
          setClientName={setClientName}
          clientEmail={clientEmail}
          setClientEmail={setClientEmail}
          clientPhone={clientPhone}
          setClientPhone={setClientPhone}
          clientCity={clientCity}
          setClientCity={setClientCity}
          clientAddress={clientAddress}
          setClientAddress={setClientAddress}
          clientGst={clientGst}
          setClientGst={setClientGst}
          clientFormatSetting={clientFormatSetting}
          setClientFormatSetting={setClientFormatSetting}
          clientGroupName={clientGroupName}
          setClientGroupName={setClientGroupName}
          clientType={clientType}
          setClientType={setClientType}
          clientPan={clientPan}
          setClientPan={setClientPan}
          clientPrimaryContact={clientPrimaryContact}
          setClientPrimaryContact={setClientPrimaryContact}
          clientPaymentTerms={clientPaymentTerms}
          setClientPaymentTerms={setClientPaymentTerms}
          clientVendorCodeField={clientVendorCodeField}
          setClientVendorCodeField={setClientVendorCodeField}
          handleCreateClient={handleCreateClient}
          setSelectedClientForProfiles={setSelectedClientForProfiles}
          fetchBillingProfiles={fetchBillingProfiles}
          setShowBillingProfileDialog={setShowBillingProfileDialog}
        />
      )}

      {/* ======================================================== */}
      {/* 4. BRANDS TAB */}
      {/* ======================================================== */}
      {activeTab === "brands" && (
        <BrandsPanel
          brands={brands}
          clients={clients}
          token={token}
          reload={fetchData}
          showBrandForm={showBrandForm}
          setShowBrandForm={setShowBrandForm}
          brandName={brandName}
          setBrandName={setBrandName}
          brandParent={brandParent}
          setBrandParent={setBrandParent}
          handleCreateBrand={handleCreateBrand}
        />
      )}

      {/* ======================================================== */}
      {/* 5. STORES TAB */}
      {/* ======================================================== */}
      {activeTab === "stores" && (
        <StoresPanel
          stores={stores}
          clients={clients}
          brands={brands}
          token={token}
          reload={fetchData}
          showStoreForm={showStoreForm}
          setShowStoreForm={setShowStoreForm}
          storeName={storeName}
          setStoreName={setStoreName}
          storeCode={storeCode}
          setStoreCode={setStoreCode}
          storeClientId={storeClientId}
          setStoreClientId={setStoreClientId}
          storeBrandId={storeBrandId}
          setStoreBrandId={setStoreBrandId}
          storeCity={storeCity}
          setStoreCity={setStoreCity}
          storeState={storeState}
          setStoreState={setStoreState}
          storeStateCode={storeStateCode}
          setStoreStateCode={setStoreStateCode}
          storeRegion={storeRegion}
          setStoreRegion={setStoreRegion}
          storeContact={storeContact}
          setStoreContact={setStoreContact}
          storePhone={storePhone}
          setStorePhone={setStorePhone}
          storeAltContact={storeAltContact}
          setStoreAltContact={setStoreAltContact}
          storeAddress={storeAddress}
          setStoreAddress={setStoreAddress}
          handleCreateStore={handleCreateStore}
        />
      )}

      {/* ======================================================== */}
      {/* 6. PRODUCTS CATALOG TAB */}
      {/* ======================================================== */}
      {activeTab === "products" && (
        <ProductsPanel
          products={products}
          materialCodes={materialCodes}
          token={token}
          reload={fetchData}
          showProductForm={showProductForm}
          setShowProductForm={setShowProductForm}
          prodName={prodName}
          setProdName={setProdName}
          prodCat={prodCat}
          setProdCat={setProdCat}
          prodUnit={prodUnit}
          setProdUnit={setProdUnit}
          prodCalcType={prodCalcType}
          setProdCalcType={setProdCalcType}
          prodRate={prodRate}
          setProdRate={setProdRate}
          prodGst={prodGst}
          setProdGst={setProdGst}
          prodHsn={prodHsn}
          setProdHsn={setProdHsn}
          prodIsStandard={prodIsStandard}
          setProdIsStandard={setProdIsStandard}
          prodSpecs={prodSpecs}
          setProdSpecs={setProdSpecs}
          prodWarranty={prodWarranty}
          setProdWarranty={setProdWarranty}
          prodMaterialCodeId={prodMaterialCodeId}
          setProdMaterialCodeId={setProdMaterialCodeId}
          prodDesc={prodDesc}
          setProdDesc={setProdDesc}
          handleCreateProduct={handleCreateProduct}
          formatCurrency={formatCurrency}
        />
      )}

      {/* ======================================================== */}
      {/* 5. MASTER DATA MANAGER TAB */}
      {/* ======================================================== */}
      {activeTab === "master_data" && (
        <MasterDataImportExportPanel
          clients={clients}
          brands={brands}
          stores={stores}
          products={products}
          token={token}
          impType={impType}
          setImpType={setImpType}
          impHeaders={impHeaders}
          setImpHeaders={setImpHeaders}
          impPreviewRows={impPreviewRows}
          setImpPreviewRows={setImpPreviewRows}
          impAllRows={impAllRows}
          setImpAllRows={setImpAllRows}
          impMappings={impMappings}
          setImpMappings={setImpMappings}
          impStats={impStats}
          setImpStats={setImpStats}
          impIsParsing={impIsParsing}
          impIsCommitting={impIsCommitting}
          impFileName={impFileName}
          setImpFileName={setImpFileName}
          handleImportFileChange={handleImportFileChange}
          handleCommitImport={handleCommitImport}
        />
      )}

      {/* ======================================================== */}
      {/* INVOICES & LEDGER TAB */}
      {/* ======================================================== */}
      {activeTab === "invoices_ledger" && (
        <InvoiceLedgerPanel
          invoices={invoices as any}
          estimates={estimates}
          challans={challans}
          clients={clients}
          ledgerSummary={ledgerSummary}
          clientStatement={clientStatement}
          activeLedgerClientId={activeLedgerClientId}
          setActiveLedgerClientId={setActiveLedgerClientId}
          setClientStatement={setClientStatement}
          statementLoading={statementLoading}
          invoiceSubTab={invoiceSubTab}
          setInvoiceSubTab={setInvoiceSubTab}
          setShowRecordPayment={setShowRecordPayment}
          openInvoiceEditor={openInvoiceEditor}
          cancelInvoice={cancelInvoice}
          deleteInvoice={deleteInvoice}
          fetchClientStatement={fetchClientStatement}
          formatCurrency={formatCurrency}
          token={token}
        />
      )}

      {/* ======================================================== */}
      {/* PROJECT TRACKER TAB */}
      {/* ======================================================== */}
      {activeTab === "project_tracker" && (
        <ProjectTrackerPanel
          estimates={estimates}
          clients={clients}
          brands={brands}
          stores={stores}
          challans={challans}
          invoices={invoices}
          formatCurrency={formatCurrency}
        />
      )}

      {/* ======================================================== */}
      {/* 6. ESTIMATE PREVIEW HELPERS */}
      {/* ======================================================== */}
      {/* PROJECT WORKSPACE — shown when user opens a project from the Projects tab */}
      {!showPoModal && selectedEstimate && !standaloneDcEditor && estimatePreviewMode === "project" && (
        <ProjectWorkspace
          estimate={selectedEstimate}
          clients={clients}
          brands={brands}
          stores={stores}
          token={token}
          onBack={() => {
            setSelectedEstimate(null);
            setEstimatePreviewMode("estimate");
            if (focusTab === "projects" && typeof window !== "undefined") history.replaceState(null, "", "/projects");
          }}
          onOpenWcc={openDcForEdit}
          onPreviewWcc={openWccPreview}
          onGenerateWcc={handleGenerateWccForStore}
          onOpenInvoice={openInvoiceEditor}
          onPoUpload={openPoForEstimate}
          onRefresh={async () => {
            await fetchData();
            await fetchLedgerData();
          }}
          initialTab={projectDashboardInitialTab as any}
        />
      )}

      {/* ESTIMATE PREVIEW — shown when user views an estimate document (not project mode) */}
      {!showPoModal && selectedEstimate && !standaloneDcEditor && estimatePreviewMode === "estimate" && (
<EstimatePreview
          clients={clients}
          brands={brands}
          stores={stores}
          products={products}
          {...{
          selectedEstimate,
          setSelectedEstimate,
	          handleUpdateStatus,
	          handleDuplicateEstimate,
	          setPoAmount,
          setShowPoModal,
          openPoForEstimate,
          handleOpenDcModal,
          token,
          selectedEstimateItems,
          selectedEstimateItemsLoading,
          selectedChallans,
          invoices,
          handleUpdateDcFiles,
          handleFileUpload,
          openDcForEdit,
          openDcPreview: openWccPreview,
          openExecutionDocumentViewer: openExecutionDocumentViewerFromOwner,
          openExecutionDocumentHistoryViewer: openExecutionDocumentHistoryFromOwner,
          deleteDeliveryChallan: deleteDeliveryChallanForPreview,
          deleteExecutionDocument: deleteExecutionDocumentFromOwner,
          printDc: printWcc,
          openInvoiceEditor,
          onInvoiceGenerated: async () => {
            await fetchLedgerData();
            await fetchData();
          },
          initialProjectTab: projectDashboardInitialTab,
          sellerProfile,
          printSettingsUserKey: user?.id || user?.username || "default",
          presentation: "modal",
          previewMode: "estimate",
          onBackToProjects: undefined,
        }}
      />
      )}

      {/* ======================================================== */}
      {/* 8. PO UPLOAD DIALOG OVERLAY */}
      {/* ======================================================== */}
      {showPoModal && selectedEstimate && (
        <PoUploadModal
          handlePoSubmit={handlePoSubmit}
          setShowPoModal={setShowPoModal}
          poNumber={poNumber}
          setPoNumber={setPoNumber}
          poDate={poDate}
          setPoDate={setPoDate}
          poAmount={poAmount}
          setPoAmount={setPoAmount}
          poFileUrl={poFileUrl}
          setPoFileUrl={setPoFileUrl}
          poRemarks={poRemarks}
          setPoRemarks={setPoRemarks}
          uploadingPo={uploadingPo}
          handleFileUpload={handleFileUpload}
        />
      )}

      {showPoModal && poWorkflowEstimate && !selectedEstimate && (
        <PoUploadModal
          handlePoSubmit={handlePoSubmit}
          setShowPoModal={(value) => {
            setShowPoModal(value);
            if (!value) setPoWorkflowEstimate(null);
          }}
          poNumber={poNumber}
          setPoNumber={setPoNumber}
          poDate={poDate}
          setPoDate={setPoDate}
          poAmount={poAmount}
          setPoAmount={setPoAmount}
          poFileUrl={poFileUrl}
          setPoFileUrl={setPoFileUrl}
          poRemarks={poRemarks}
          setPoRemarks={setPoRemarks}
          uploadingPo={uploadingPo}
          handleFileUpload={handleFileUpload}
        />
      )}

      {executionDocumentViewer && (
        <div data-qa="execution-document-viewer-modal" className="fixed inset-0 z-[120] bg-slate-950/70 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-6xl h-[88vh] rounded-lg shadow-2xl border border-slate-200 overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b border-slate-200 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-wider text-orange-600">{String(executionDocumentViewer.documentType || "Document").replace(/_/g, " ")}</p>
                <h2 className="font-bold text-slate-900 truncate">{executionDocFileName(executionDocumentViewer)}</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Store {executionDocumentViewer.storeCode || "—"} · v{executionDocumentViewer.version || 1}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <label className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-50 border border-blue-200 text-blue-700 text-xs font-bold rounded hover:bg-blue-100 cursor-pointer">
                  Replace
                  <input type="file" className="hidden" onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) replaceExecutionDocumentFromOwner(executionDocumentViewer, file);
                  }} />
                </label>
                <button type="button" onClick={() => loadExecutionDocumentVersionsFromOwner(executionDocumentViewer)} className="inline-flex items-center gap-1 px-3 py-1.5 bg-white border border-slate-200 text-slate-700 text-xs font-bold rounded hover:bg-slate-100">
                  History
                </button>
                <button type="button" onClick={() => deleteExecutionDocumentFromOwner(executionDocumentViewer)} className="inline-flex items-center gap-1 px-3 py-1.5 bg-red-50 border border-red-200 text-red-700 text-xs font-bold rounded hover:bg-red-100">
                  Delete
                </button>
                <a href={executionDocumentViewer.filePath} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-3 py-1.5 bg-slate-50 border border-slate-200 text-slate-700 text-xs font-bold rounded hover:bg-slate-100">
                  Open
                </a>
                <a href={executionDocumentViewer.filePath} download className="inline-flex items-center gap-1 px-3 py-1.5 bg-orange-50 border border-orange-200 text-orange-700 text-xs font-bold rounded hover:bg-orange-100">
                  Download
                </a>
                <button type="button" onClick={() => { setExecutionDocumentViewer(null); setExecutionDocumentVersions([]); setShowExecutionDocumentHistory(false); }} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            {showExecutionDocumentHistory && (
              <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-700">Version History</h3>
                  <button type="button" onClick={() => setShowExecutionDocumentHistory(false)} className="text-[10px] font-black text-slate-500 hover:text-slate-900">Hide</button>
                </div>
                {executionDocumentVersions.length ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2 text-xs">
                    {executionDocumentVersions.map((doc) => (
                      <div key={doc.id} className={`border rounded p-2 ${doc.status === "active" ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white"}`}>
                        <div className="font-mono font-bold text-slate-800 truncate">{executionDocFileName(doc)}</div>
                        <div className="text-[10px] text-slate-500 mt-1">v{doc.version || 1} · {doc.status || "active"} · {doc.uploadedAt || doc.createdAt ? new Date(doc.uploadedAt || doc.createdAt).toLocaleDateString("en-GB") : "—"}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400">No version history loaded.</p>
                )}
              </div>
            )}
            <div className="flex-1 bg-slate-100 overflow-auto">
              {executionDocIsImage(executionDocumentViewer) ? (
                <div className="min-h-full flex items-center justify-center p-4">
                  <img
                    src={executionDocumentViewer.filePath}
                    alt={executionDocFileName(executionDocumentViewer)}
                    className="max-w-full max-h-full object-contain bg-white shadow-sm"
                    onError={(e) => {
                      const el = e.currentTarget;
                      el.style.display = "none";
                      const msg = document.createElement("div");
                      msg.className = "text-center text-slate-500 p-8";
                      msg.innerHTML = '<p class="text-sm font-bold text-red-600">File not found on server.</p><p class="text-xs text-slate-400 mt-1">The original file may have been deleted. Use Replace to upload a new copy.</p>';
                      el.parentElement?.appendChild(msg);
                    }}
                  />
                </div>
              ) : executionDocIsPdf(executionDocumentViewer) ? (
                <iframe title={executionDocFileName(executionDocumentViewer)} src={executionDocumentViewer.filePath} className="w-full h-full bg-white" />
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center text-slate-500 p-8">
                  <FileText className="w-12 h-12 text-slate-300 mb-3" />
                  <p className="text-sm font-bold text-slate-700">Preview is not available for this file type.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <WccDcEditor
        {...{
          clients,
          brands,
          stores,
          wccChecklist,
          setDcPhotos,
          showDcModal,
          selectedEstimate,
          handleDcSubmit,
          setShowDcModal: (value: boolean) => {
            setShowDcModal(value);
            if (!value && standaloneDcEditor) {
              setSelectedEstimate(null);
              setStandaloneDcEditor(false);
            }
          },
          dcFormat,
          setDcFormat,
          dcNumberVal,
          setDcNumberVal,
          dcWccStoreScope,
          setDcWccStoreScope,
          wccShortageNotes,
          setWccShortageNotes,
          setWccChecklist,
          handleBatchGenerateWcc,
          handleMultiPhotoUpload,
          handleApplyCurrentPhotosToAllWccs,
          handleApplyCurrentPhotosToSelectedWccs,
          handleUseCurrentWccAsTemplateForRemainingStores,
          handleBulkReplacePhoto,
          dcPhotos,
          dcRemarks,
          setDcRemarks,
          dcDeliveredBy,
          dcReceivedBy,
          wccAuthPerson,
          selectedEstimateItems,
          showDcPreviewModal,
          selectedDcForPreview,
          estimates,
          challans,
          setSelectedDcForPreview,
          setShowDcPreviewModal,
          editingDcId,
          activeWccsForEditor,
          navigateWccEditor,
          printAllWccs,
          wccPrintMode,
          setWccPrintMode,
          token,
          sellerProfile
        }}
      />

      {/* ======================================================== */}
      {/* BILLING PROFILES / MULTI-GST MODAL */}
      {/* ======================================================== */}
      <BillingProfilesDialog
        show={showBillingProfileDialog}
        selectedClient={selectedClientForProfiles}
        billingProfiles={billingProfiles}
        showBpForm={showBpForm}
        editingBpId={editingBpId}
        bpLegalName={bpLegalName}
        bpBranch={bpBranch}
        bpGstin={bpGstin}
        bpPan={bpPan}
        bpState={bpState}
        bpStateCode={bpStateCode}
        bpBillingAddress={bpBillingAddress}
        bpShippingAddress={bpShippingAddress}
        bpContactPerson={bpContactPerson}
        bpMobile={bpMobile}
        bpEmail={bpEmail}
        bpNotes={bpNotes}
        bpIsDefault={bpIsDefault}
        bpIsActive={bpIsActive}
        setShowBillingProfileDialog={setShowBillingProfileDialog}
        setSelectedClientForProfiles={setSelectedClientForProfiles}
        setShowBpForm={setShowBpForm}
        setEditingBpId={setEditingBpId}
        setBpLegalName={setBpLegalName}
        setBpBranch={setBpBranch}
        setBpGstin={setBpGstin}
        setBpPan={setBpPan}
        setBpState={setBpState}
        setBpStateCode={setBpStateCode}
        setBpBillingAddress={setBpBillingAddress}
        setBpShippingAddress={setBpShippingAddress}
        setBpContactPerson={setBpContactPerson}
        setBpMobile={setBpMobile}
        setBpEmail={setBpEmail}
        setBpNotes={setBpNotes}
        setBpIsDefault={setBpIsDefault}
        setBpIsActive={setBpIsActive}
        handleDeleteBillingProfile={handleDeleteBillingProfile}
        handleCreateOrUpdateBillingProfile={handleCreateOrUpdateBillingProfile}
      />

      <InvoiceEditor
        open={invoiceEditor.open}
        invoiceId={invoiceEditor.invoiceId ?? null}
        estimateId={invoiceEditor.estimateId ?? null}
        deliveryChallanId={invoiceEditor.deliveryChallanId ?? null}
        onClose={closeInvoiceEditor}
        onSaved={() => { fetchLedgerData(); }}
      />

      {/* ======================================================== */}
      {/* INVOICE PACKET BUILDER MODAL */}
      {/* ======================================================== */}
      {showPacketBuilder && selectedEstForPacket && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
            <div className="bg-slate-900 text-white p-5 flex justify-between items-center">
              <div>
                <span className="text-[10px] font-black tracking-widest text-orange-400 uppercase">Invoice Generator</span>
                <h3 className="text-lg font-bold">Create Tax Invoice</h3>
              </div>
              <button onClick={() => { setShowPacketBuilder(false); setSelectedEstForPacket(null); }} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateInvoice} className="p-6 space-y-5">
              <div className="bg-slate-50 rounded-xl border border-slate-100 p-4 text-xs space-y-1">
                <p className="font-black text-slate-500 uppercase text-[10px] tracking-wider">Linked Estimate</p>
                <p className="font-bold text-slate-800">{selectedEstForPacket.estimateNumber} — {selectedEstForPacket.title}</p>
                <div className="grid grid-cols-2 gap-2 mt-2 font-mono">
                  <div><span className="text-slate-400">Subtotal:</span> <span className="font-bold">{formatCurrency(selectedEstForPacket.subtotal)}</span></div>
                  <div><span className="text-slate-400">Tax:</span> <span className="font-bold">{formatCurrency(selectedEstForPacket.taxAmount)}</span></div>
                  <div><span className="text-slate-400">Total:</span> <span className="font-black text-orange-700">{formatCurrency(selectedEstForPacket.totalAmount)}</span></div>
                  <div><span className="text-slate-400">PO No:</span> <span className="font-bold">{selectedEstForPacket.poNumber || "—"}</span></div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">Invoice Number *</label>
                  <input
                    required
                    value={invoiceNumberInput}
                    onChange={(e) => setInvoiceNumberInput(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs font-mono font-bold focus:outline-none focus:border-orange-500"
                    placeholder="INV/2026/001"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">Invoice Date *</label>
                  <input
                    type="date"
                    required
                    value={invoiceDateInput}
                    onChange={(e) => setInvoiceDateInput(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-orange-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">Due Date *</label>
                  <input
                    type="date"
                    required
                    value={invoiceDueDateInput}
                    onChange={(e) => setInvoiceDueDateInput(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-orange-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">Remarks / Reference</label>
                  <input
                    value={invoiceRemarksInput}
                    onChange={(e) => setInvoiceRemarksInput(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-orange-500"
                    placeholder="Job reference, PO link, notes…"
                  />
                </div>
              </div>

              <div>
                <p className="text-[10px] font-black text-slate-500 uppercase mb-2">Include in Invoice Packet</p>
                <div className="flex flex-wrap gap-2">
                  {packetPageOrder.map(page => (
                    <label key={page} className="flex items-center gap-1.5 cursor-pointer text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5">
                      <input
                        type="checkbox"
                        checked={packetCheckedPages.includes(page)}
                        onChange={(e) => {
                          if (e.target.checked) setPacketCheckedPages(prev => [...prev, page]);
                          else setPacketCheckedPages(prev => prev.filter(p => p !== page));
                        }}
                        className="accent-orange-500"
                      />
                      <span className="capitalize font-semibold">{page.replace("_", " ")}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
                <button type="button" onClick={() => { setShowPacketBuilder(false); setSelectedEstForPacket(null); }}
                  className="py-2 px-5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition">
                  Cancel
                </button>
                <button type="submit"
                  className="py-2 px-6 bg-orange-600 hover:bg-orange-500 text-white text-xs font-bold rounded-lg transition shadow-sm">
                  Generate Invoice
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* RECORD PAYMENT MODAL */}
      {/* ======================================================== */}
      {showRecordPayment && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
            <div className="bg-slate-900 text-white p-5 flex justify-between items-center">
              <div>
                <span className="text-[10px] font-black tracking-widest text-green-400 uppercase">Collections</span>
                <h3 className="text-lg font-bold">Record Customer Payment</h3>
              </div>
              <button onClick={() => setShowRecordPayment(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleRecordPayment} className="p-6 space-y-4">
              <div>
                <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">Client *</label>
                <select
                  required
                  value={paymentClientId}
                  onChange={(e) => { setPaymentClientId(e.target.value); setPaymentAllocations({}); }}
                  className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-orange-500"
                >
                  <option value="">— Select client —</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">Amount Received *</label>
                  <input
                    type="number"
                    required
                    min={0}
                    step="0.01"
                    value={paymentAmount}
                    onChange={(e) => setPaymentAmount(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs font-mono font-bold focus:outline-none focus:border-orange-500"
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">Payment Method</label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-orange-500"
                  >
                    <option value="bank_transfer">Bank Transfer / NEFT</option>
                    <option value="upi">UPI</option>
                    <option value="cheque">Cheque</option>
                    <option value="cash">Cash</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">Payment Date</label>
                  <input
                    type="date"
                    value={paymentDate}
                    onChange={(e) => setPaymentDate(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-orange-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">Remarks / UTR Ref</label>
                  <input
                    value={paymentRemarks}
                    onChange={(e) => setPaymentRemarks(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-orange-500"
                    placeholder="UTR / Reference number…"
                  />
                </div>
              </div>
              {paymentClientId && (
                <div>
                  <p className="text-[10px] font-black text-slate-500 uppercase mb-2">Allocate to Outstanding Invoices</p>
                  {invoices.filter(inv => inv.clientId === Number(paymentClientId) && inv.status !== "paid").length === 0 ? (
                    <p className="text-xs text-slate-400 italic">No outstanding invoices for this client.</p>
                  ) : (
                    <div className="space-y-2 max-h-36 overflow-y-auto">
                      {invoices.filter(inv => inv.clientId === Number(paymentClientId) && inv.status !== "paid").map(inv => (
                        <div key={inv.id} className="flex items-center gap-2 text-xs bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
                          <span className="font-mono font-bold text-slate-700 w-28 shrink-0">{inv.invoiceNumber}</span>
                          <span className="text-slate-500 flex-1">Balance: {formatCurrency(inv.balanceAmount || inv.totalAmount)}</span>
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            placeholder="Allocate ₹"
                            value={paymentAllocations[inv.id] || ""}
                            onChange={(e) => setPaymentAllocations(prev => ({ ...prev, [inv.id]: Number(e.target.value) }))}
                            className="w-28 px-2 py-1 bg-white border border-slate-200 rounded text-xs font-mono font-bold text-right focus:outline-none focus:border-orange-500"
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
                <button type="button" onClick={() => setShowRecordPayment(false)}
                  className="py-2 px-5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition">
                  Cancel
                </button>
                <button type="submit"
                  className="py-2 px-6 bg-green-600 hover:bg-green-500 text-white text-xs font-bold rounded-lg transition shadow-sm">
                  Record Payment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};

export default OperationsPage;
