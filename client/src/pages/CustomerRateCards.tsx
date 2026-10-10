import React, { useEffect, useState, useMemo, useRef } from "react";
import { useAuth } from "../contexts/AuthContext";
import {
  fetchClients,
  fetchBrands,
  fetchProducts,
  fetchMaterialCodes,
  fetchCustomerRateCards,
  fetchRateCardItems,
  createRateCard,
  updateRateCard,
  deleteRateCard,
  importProductsToRateCard,
  batchUpdateRateCardItems,
  apiFetch,
} from "../lib/api";
import {
  Download,
  Upload,
  Save,
  Search,
  Plus,
  RefreshCw,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Layers,
  ArrowRight,
  Database,
  Building2,
  Trash2,
  Eye,
  Filter,
} from "lucide-react";

interface Client {
  id: number;
  name: string;
}

interface Brand {
  id: number;
  name: string;
}

interface Product {
  id: number;
  name: string;
  rate: number;
  unit: string;
  materialCode?: string | null;
  isActive: boolean;
}

interface MaterialCode {
  id: number;
  code: string;
}

interface RateCard {
  id: number;
  name: string | null;
  clientId: number;
  brandId: number | null;
  projectType: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  isActive: boolean;
  notes: string | null;
  createdAt: string;
}

interface RateItem {
  id: number;
  rateCardId: number;
  productId: number | null;
  materialCodeId: number | null;
  itemName: string | null;
  description: string | null;
  hsn: string | null;
  uom: string;
  calculationType: string | null;
  rate: number;
  gstPercent: number;
  isStandard: boolean;
  isActive: boolean;
  // joined from products
  productName?: string;
  productMaterialCode?: string;
  productBrandId?: number | null;
  productUnit?: string;
  productStandardRate?: number;
  productIsActive?: boolean;
}

interface StagedExcelRow {
  productId: number;
  productName: string;
  oldRate: number;
  newRate: number;
  isActive: boolean;
  status: "updated" | "unchanged" | "skipped" | "failed";
  reason?: string;
}

export default function CustomerRateCards() {
  const { token } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Master lists
  const [clients, setClients] = useState<Client[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [materialCodes, setMaterialCodes] = useState<MaterialCode[]>([]);

  // Selection states
  const [selectedClientId, setSelectedClientId] = useState<number | "">("");
  const [clientRateCards, setClientRateCards] = useState<RateCard[]>([]);
  const [activeCardId, setActiveCardId] = useState<number | null>(null);

  // Active Rate Card fields
  const [cardName, setCardName] = useState("");
  const [cardBrandId, setCardBrandId] = useState<number | null>(null);

  // Table items & edits
  const [items, setItems] = useState<RateItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [importingProducts, setImportingProducts] = useState(false);

  // Filtering & Search
  const [searchQuery, setSearchQuery] = useState("");
  const [filterBrandId, setFilterBrandId] = useState<string>("");
  const [showUnpricedOnly, setShowUnpricedOnly] = useState(false);

  // Status message
  const [statusMessage, setStatusMessage] = useState<{
    type: "success" | "error" | "info";
    text: string;
  } | null>(null);

  // Excel Import Preview Modal
  const [showImportModal, setShowImportModal] = useState(false);
  const [importSummary, setImportSummary] = useState<{
    total: number;
    updated: number;
    unchanged: number;
    failed: number;
    stagedRows: StagedExcelRow[];
  } | null>(null);

  // Rate Resolver Quick-Check
  const [showResolver, setShowResolver] = useState(false);
  const [rProductId, setRProductId] = useState<string>("");
  const [resolvedResult, setResolvedResult] = useState<any>(null);
  const [resolving, setResolving] = useState(false);

  // 1. Initial Load of Master Data
  useEffect(() => {
    if (!token) return;
    const loadMasters = async () => {
      try {
        const [cls, brs, prods, mcs] = await Promise.all([
          fetchClients(token).catch(() => []),
          fetchBrands(token).catch(() => []),
          fetchProducts(token).catch(() => []),
          fetchMaterialCodes(token).catch(() => []),
        ]);
        setClients(cls || []);
        setBrands(brs || []);
        setProducts(prods || []);
        setMaterialCodes(mcs || []);

        // Deep-link query parameters (?clientId=X)
        const params = new URLSearchParams(window.location.search);
        const urlClientId = params.get("clientId");
        if (urlClientId) {
          setSelectedClientId(Number(urlClientId));
        } else if (cls && cls.length > 0) {
          setSelectedClientId(cls[0].id);
        }
      } catch (err: any) {
        console.error("Failed to load master data:", err);
      }
    };
    loadMasters();
  }, [token]);

  // 2. Load Rate Cards when Client changes
  useEffect(() => {
    if (!token || !selectedClientId) {
      setClientRateCards([]);
      setActiveCardId(null);
      setItems([]);
      return;
    }

    const loadClientCards = async () => {
      setLoading(true);
      try {
        const cards: RateCard[] = await fetchCustomerRateCards(token, Number(selectedClientId));
        setClientRateCards(cards);

        if (cards.length > 0) {
          // Open the active or first card
          const targetCard = cards.find(c => c.isActive) || cards[0];
          setActiveCardId(targetCard.id);
          setCardName(targetCard.name || `${selectedClientName} Rate Card`);
          setCardBrandId(targetCard.brandId);
        } else {
          setActiveCardId(null);
          setCardName(`${selectedClientName} Rate Card`);
          setCardBrandId(null);
          setItems([]);
        }
      } catch (err: any) {
        console.error("Failed to load client rate cards:", err);
      } finally {
        setLoading(false);
      }
    };
    loadClientCards();
  }, [token, selectedClientId]);

  // 3. Load Items when Active Rate Card changes
  const reloadCardItems = async (cardId: number) => {
    if (!token) return;
    setLoading(true);
    try {
      const cardItems: RateItem[] = await fetchRateCardItems(token, cardId);
      setItems(cardItems || []);
    } catch (err: any) {
      console.error("Failed to load rate card items:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (activeCardId) {
      reloadCardItems(activeCardId);
      const activeCard = clientRateCards.find(c => c.id === activeCardId);
      if (activeCard) {
        setCardName(activeCard.name || "");
        setCardBrandId(activeCard.brandId);
      }
    } else {
      setItems([]);
    }
  }, [activeCardId]);

  const selectedClient = clients.find(c => c.id === Number(selectedClientId));
  const selectedClientName = selectedClient ? selectedClient.name : "";

  // 4. Create New Rate Card
  const handleCreateRateCard = async () => {
    if (!token || !selectedClientId) return;
    setSaving(true);
    try {
      const name = cardName.trim() || `${selectedClientName} Rate Card`;
      const created = await createRateCard(token, {
        clientId: Number(selectedClientId),
        name,
        brandId: cardBrandId || null,
        isActive: true,
      });

      // Reload client cards and auto-import all products
      const updatedCards: RateCard[] = await fetchCustomerRateCards(token, Number(selectedClientId));
      setClientRateCards(updatedCards);
      setActiveCardId(created.id);
      setCardName(created.name || name);

      // Auto import products
      const impRes = await importProductsToRateCard(token, created.id);
      await reloadCardItems(created.id);

      setStatusMessage({
        type: "success",
        text: `Rate Card "${name}" created! ${impRes.message || ""}`,
      });
    } catch (err: any) {
      setStatusMessage({ type: "error", text: err.message || "Failed to create rate card" });
    } finally {
      setSaving(false);
    }
  };

  // 5. Import All Products Action
  const handleImportAllProducts = async () => {
    if (!token) return;
    if (!activeCardId) {
      // If no card yet, create one first
      await handleCreateRateCard();
      return;
    }

    setImportingProducts(true);
    setStatusMessage(null);
    try {
      const res = await importProductsToRateCard(token, activeCardId);
      await reloadCardItems(activeCardId);
      setStatusMessage({
        type: "success",
        text: res.message || `Imported ${res.importedCount} new products (${res.existingCount} already present).`,
      });
    } catch (err: any) {
      setStatusMessage({
        type: "error",
        text: err.message || "Failed to import products from master catalog.",
      });
    } finally {
      setImportingProducts(false);
    }
  };

  // 6. Inline Rate Edit Handlers
  const handleRateChange = (itemId: number, newRateStr: string) => {
    const parsed = newRateStr === "" ? 0 : parseFloat(newRateStr);
    setItems(prev =>
      prev.map(it => (it.id === itemId ? { ...it, rate: isNaN(parsed) ? 0 : parsed } : it))
    );
  };

  const handleActiveToggle = (itemId: number, checked: boolean) => {
    setItems(prev =>
      prev.map(it => (it.id === itemId ? { ...it, isActive: checked } : it))
    );
  };

  // 7. Save Rate Card & Items
  const handleSaveRateCard = async () => {
    if (!token) return;
    if (!activeCardId) {
      await handleCreateRateCard();
      return;
    }

    setSaving(true);
    setStatusMessage(null);
    try {
      // 1. Update Card Details (name, brand)
      if (cardName.trim()) {
        await updateRateCard(token, activeCardId, {
          name: cardName.trim(),
          brandId: cardBrandId || null,
        });
      }

      // 2. Batch Update Items
      const batchPayload = items.map(it => ({
        id: it.id,
        rate: Number(it.rate) || 0,
        isActive: it.isActive,
      }));

      await batchUpdateRateCardItems(token, activeCardId, batchPayload);

      setStatusMessage({
        type: "success",
        text: `Rate Card "${cardName}" saved successfully with ${items.length} items!`,
      });
    } catch (err: any) {
      setStatusMessage({ type: "error", text: err.message || "Failed to save rate card" });
    } finally {
      setSaving(false);
    }
  };

  // 8. Export to Excel Workflow
  const handleExportExcel = async () => {
    if (!activeCardId || items.length === 0) {
      alert("Please open or import products into a Rate Card before exporting.");
      return;
    }

    try {
      const XLSX = (await import("xlsx-js-style")).default || (await import("xlsx-js-style"));

      const cardBrand = brands.find(b => b.id === cardBrandId);
      const cardBrandName = cardBrand ? cardBrand.name : "All Brands";

      const exportRows = items.map(it => {
        const prod = products.find(p => p.id === it.productId);
        return {
          "Client Name": selectedClientName,
          "Rate Card Name": cardName || `Rate Card #${activeCardId}`,
          "Product ID": it.productId ?? "",
          "Product Name": it.productName || it.itemName || prod?.name || "",
          "Material Code": it.productMaterialCode || it.hsn || prod?.materialCode || "—",
          "Brand": cardBrandName,
          "Unit": it.uom || it.productUnit || prod?.unit || "pcs",
          "Rate": Number(it.rate) > 0 ? Number(it.rate) : "",
          "Active": it.isActive ? "YES" : "NO",
        };
      });

      const worksheet = XLSX.utils.json_to_sheet(exportRows);

      // Auto-size columns
      worksheet["!cols"] = [
        { wch: 22 }, // Client Name
        { wch: 26 }, // Rate Card Name
        { wch: 12 }, // Product ID
        { wch: 32 }, // Product Name
        { wch: 18 }, // Material Code
        { wch: 18 }, // Brand
        { wch: 10 }, // Unit
        { wch: 14 }, // Rate
        { wch: 10 }, // Active
      ];

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Rate Card");

      const cleanFileName = `RateCard_${selectedClientName.replace(/[^a-zA-Z0-9_-]/g, "_")}_${cardName.replace(/[^a-zA-Z0-9_-]/g, "_")}.xlsx`;
      XLSX.writeFile(workbook, cleanFileName);
    } catch (err: any) {
      console.error("Export failed:", err);
      alert("Failed to export Excel file: " + err.message);
    }
  };

  // 9. Import Updated Excel Workflow
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const XLSX = (await import("xlsx-js-style")).default || (await import("xlsx-js-style"));
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const rawRows: any[] = XLSX.utils.sheet_to_json(worksheet);

      if (!rawRows || rawRows.length === 0) {
        alert("The uploaded workbook contains no data rows.");
        return;
      }

      // Map existing items by productId
      const currentItemsMap = new Map<number, RateItem>();
      items.forEach(it => {
        if (it.productId) currentItemsMap.set(it.productId, it);
      });

      let updatedCount = 0;
      let unchangedCount = 0;
      let failedCount = 0;
      const staged: StagedExcelRow[] = [];

      for (const row of rawRows) {
        // Find product ID column flexibly
        const rawPid = row["Product ID"] ?? row["ProductID"] ?? row["product_id"] ?? row["Product Id"];
        const pid = Number(rawPid);

        const rawRate = row["Rate"] ?? row["rate"] ?? row["Price"] ?? row["price"];
        const rawActive = row["Active"] ?? row["active"];

        if (!pid || isNaN(pid)) {
          failedCount++;
          staged.push({
            productId: 0,
            productName: String(row["Product Name"] || "Unknown"),
            oldRate: 0,
            newRate: 0,
            isActive: false,
            status: "failed",
            reason: "Missing or invalid Product ID in row.",
          });
          continue;
        }

        const existingItem = currentItemsMap.get(pid);
        if (!existingItem) {
          failedCount++;
          staged.push({
            productId: pid,
            productName: String(row["Product Name"] || `Product #${pid}`),
            oldRate: 0,
            newRate: 0,
            isActive: false,
            status: "failed",
            reason: `Product ID #${pid} does not exist in this Rate Card. Click "Import All Products" first.`,
          });
          continue;
        }

        const parsedRate = rawRate === "" || rawRate === undefined || rawRate === null ? 0 : Number(rawRate);
        if (isNaN(parsedRate) || parsedRate < 0) {
          failedCount++;
          staged.push({
            productId: pid,
            productName: existingItem.productName || existingItem.itemName || `Product #${pid}`,
            oldRate: existingItem.rate,
            newRate: 0,
            isActive: existingItem.isActive,
            status: "failed",
            reason: `Invalid rate value "${rawRate}". Rates cannot be negative or text.`,
          });
          continue;
        }

        const parsedActive =
          rawActive === undefined || rawActive === null
            ? existingItem.isActive
            : String(rawActive).trim().toUpperCase() === "YES" || String(rawActive).trim() === "1" || String(rawActive).trim().toUpperCase() === "TRUE";

        const hasChanged = parsedRate !== existingItem.rate || parsedActive !== existingItem.isActive;

        if (hasChanged) {
          updatedCount++;
          staged.push({
            productId: pid,
            productName: existingItem.productName || existingItem.itemName || `Product #${pid}`,
            oldRate: existingItem.rate,
            newRate: parsedRate,
            isActive: parsedActive,
            status: "updated",
          });
        } else {
          unchangedCount++;
          staged.push({
            productId: pid,
            productName: existingItem.productName || existingItem.itemName || `Product #${pid}`,
            oldRate: existingItem.rate,
            newRate: parsedRate,
            isActive: parsedActive,
            status: "unchanged",
          });
        }
      }

      setImportSummary({
        total: rawRows.length,
        updated: updatedCount,
        unchanged: unchangedCount,
        failed: failedCount,
        stagedRows: staged,
      });
      setShowImportModal(true);
    } catch (err: any) {
      alert("Error reading Excel file: " + err.message);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // 10. Commit Excel Import Updates
  const handleConfirmImport = async () => {
    if (!token || !activeCardId || !importSummary) return;
    setSaving(true);
    try {
      const updatesToApply = importSummary.stagedRows.filter(r => r.status === "updated");

      const batch = updatesToApply.map(r => ({
        productId: r.productId,
        rate: r.newRate,
        isActive: r.isActive,
      }));

      if (batch.length > 0) {
        await batchUpdateRateCardItems(token, activeCardId, batch);
      }

      await reloadCardItems(activeCardId);
      setShowImportModal(false);
      setImportSummary(null);
      setStatusMessage({
        type: "success",
        text: `Excel rates applied successfully! Updated ${updatesToApply.length} products.`,
      });
    } catch (err: any) {
      alert("Failed to apply imported rates: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  // 11. Rate Resolver Quick-Check
  const handleTestResolve = async () => {
    if (!token || !selectedClientId || !rProductId) return;
    setResolving(true);
    setResolvedResult(null);
    try {
      const params = new URLSearchParams({
        clientId: String(selectedClientId),
        productId: String(rProductId),
      });
      if (cardBrandId) params.set("brandId", String(cardBrandId));
      const res = await apiFetch(`/api/customer-rate-cards/resolve?${params.toString()}`, token);
      if (res.ok) {
        const data = await res.json();
        setResolvedResult(data || "NO_MATCH");
      } else {
        setResolvedResult("ERROR");
      }
    } catch {
      setResolvedResult("ERROR");
    } finally {
      setResolving(false);
    }
  };

  // 12. Filtered Table Rows
  const filteredItems = useMemo(() => {
    return items.filter(it => {
      // Unpriced filter
      if (showUnpricedOnly && Number(it.rate) > 0) return false;

      // Brand filter
      if (filterBrandId) {
        if (String(cardBrandId || "") !== filterBrandId) return false;
      }

      // Search query filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const pName = (it.productName || it.itemName || "").toLowerCase();
        const mCode = (it.productMaterialCode || it.hsn || "").toLowerCase();
        const brandName = (brands.find(b => b.id === cardBrandId)?.name || "").toLowerCase();
        return pName.includes(q) || mCode.includes(q) || brandName.includes(q);
      }

      return true;
    });
  }, [items, showUnpricedOnly, filterBrandId, searchQuery, products, brands]);

  const pricedCount = items.filter(it => Number(it.rate) > 0).length;
  const unpricedCount = items.length - pricedCount;

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      {/* Hidden File Input for Excel Import */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileSelect}
        accept=".xlsx, .xls"
        className="hidden"
      />

      {/* Top Banner / Breadcrumb */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-white p-4 rounded-lg border border-slate-200 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <Database className="w-5 h-5 text-orange-600" />
            <h1 className="text-xl font-bold text-slate-900">Customer Rate Cards</h1>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Simple customer price list. Rates auto-populate into Estimate Builder for the selected client.
          </p>
        </div>

        {/* Quick Diagnostic / Resolver Toggle */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowResolver(s => !s)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-md transition-colors"
          >
            <HelpCircle className="w-3.5 h-3.5 text-orange-600" />
            {showResolver ? "Hide Rate Tester" : "Test Estimate Lookup"}
          </button>
        </div>
      </div>

      {/* Status Alert Banner */}
      {statusMessage && (
        <div
          className={`p-3 rounded-md text-xs font-medium flex items-center justify-between gap-2 shadow-sm ${
            statusMessage.type === "success"
              ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
              : statusMessage.type === "error"
              ? "bg-red-50 text-red-800 border border-red-200"
              : "bg-blue-50 text-blue-800 border border-blue-200"
          }`}
        >
          <div className="flex items-center gap-2">
            {statusMessage.type === "success" ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            )}
            <span>{statusMessage.text}</span>
          </div>
          <button
            onClick={() => setStatusMessage(null)}
            className="text-slate-400 hover:text-slate-600 font-bold px-1"
          >
            ×
          </button>
        </div>
      )}

      {/* Rate Tester Collapsible Widget */}
      {showResolver && (
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs space-y-2">
          <div className="font-semibold text-slate-800 flex items-center gap-1.5">
            <HelpCircle className="w-4 h-4 text-orange-600" />
            Estimate Rate Resolution Tester
          </div>
          <p className="text-[11px] text-slate-500">
            Simulates the exact price query made by Estimate Builder when selecting this client and product.
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <div className="w-48">
              <span className="text-[10px] text-slate-400 block mb-0.5">Client</span>
              <div className="font-bold text-slate-700 truncate">{selectedClientName || "None selected"}</div>
            </div>
            <div className="w-64">
              <span className="text-[10px] text-slate-400 block mb-0.5">Product</span>
              <select
                value={rProductId}
                onChange={e => setRProductId(e.target.value)}
                className="w-full text-xs border border-slate-300 rounded px-2 py-1 bg-white"
              >
                <option value="">— Pick a product —</option>
                {products.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={handleTestResolve}
              disabled={!selectedClientId || !rProductId || resolving}
              className="mt-3 px-3 py-1 bg-orange-600 hover:bg-orange-500 disabled:opacity-40 text-white rounded text-xs font-bold"
            >
              {resolving ? "Checking…" : "Test Lookup"}
            </button>
            {resolvedResult === "NO_MATCH" && (
              <span className="mt-3 text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded text-[11px]">
                No client-specific rate found (Estimate Builder uses catalog default rate).
              </span>
            )}
            {resolvedResult && resolvedResult !== "NO_MATCH" && resolvedResult !== "ERROR" && (
              <span className="mt-3 text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded text-[11px] font-semibold">
                Match Found: ₹{resolvedResult.rate} / {resolvedResult.uom} (Rate Card #{resolvedResult.rateCardId})
              </span>
            )}
          </div>
        </div>
      )}

      {/* Main Control Toolbar */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm space-y-4">
        {/* Top Controls: Client, Brand, Card Name, Action Buttons */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
          {/* Client Selector (Required) */}
          <div className="md:col-span-3">
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Select Client <span className="text-red-500">*</span>
            </label>
            <select
              value={selectedClientId}
              onChange={e => setSelectedClientId(e.target.value ? Number(e.target.value) : "")}
              className="w-full text-xs font-semibold border border-slate-300 rounded-md px-2.5 py-1.5 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500"
            >
              <option value="">— Choose a Client —</option>
              {clients.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* Rate Card Selector / Name */}
          <div className="md:col-span-3">
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-bold text-slate-700">Rate Card Name</label>
              {clientRateCards.length > 1 && (
                <select
                  value={activeCardId || ""}
                  onChange={e => setActiveCardId(Number(e.target.value))}
                  className="text-[10px] text-orange-600 bg-orange-50 border border-orange-200 rounded px-1"
                >
                  {clientRateCards.map(c => (
                    <option key={c.id} value={c.id}>
                      Switch Card #{c.id}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <input
              type="text"
              value={cardName}
              onChange={e => setCardName(e.target.value)}
              placeholder="e.g. Sunrise Media Standard Rate Card"
              className="w-full text-xs border border-slate-300 rounded-md px-2.5 py-1.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
          </div>

          {/* Brand Dropdown (Optional) */}
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-slate-600 mb-1">Brand (Optional)</label>
            <select
              value={cardBrandId || ""}
              onChange={e => setCardBrandId(e.target.value ? Number(e.target.value) : null)}
              className="w-full text-xs border border-slate-300 rounded-md px-2.5 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-orange-500"
            >
              <option value="">All Brands</option>
              {brands.map(b => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>

          {/* Action Buttons: Import All Products & Save Rate Card */}
          <div className="md:col-span-4 flex items-center justify-end gap-2">
            <button
              onClick={handleImportAllProducts}
              disabled={!selectedClientId || importingProducts}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-600 hover:bg-orange-500 disabled:opacity-40 text-white rounded-md text-xs font-bold shadow-sm transition-all"
              title="Pull all products from Master Catalog into this rate card"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${importingProducts ? "animate-spin" : ""}`} />
              {importingProducts ? "Importing…" : "Import All Products"}
            </button>

            <button
              onClick={handleSaveRateCard}
              disabled={!selectedClientId || saving}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded-md text-xs font-bold shadow-sm transition-all"
            >
              <Save className="w-3.5 h-3.5" />
              {saving ? "Saving…" : "Save Rate Card"}
            </button>
          </div>
        </div>

        {/* Secondary Bar: Excel Import / Export + Table Search & Filters */}
        <div className="pt-3 border-t border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Excel Controls */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleExportExcel}
              disabled={!activeCardId || items.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 text-slate-700 text-xs font-semibold rounded-md border border-slate-200 transition-colors"
              title="Download rate card as Excel to edit offline"
            >
              <Download className="w-3.5 h-3.5 text-emerald-700" />
              Export Excel
            </button>

            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={!activeCardId || items.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 text-slate-700 text-xs font-semibold rounded-md border border-slate-200 transition-colors"
              title="Upload edited Excel workbook to update rates in bulk"
            >
              <Upload className="w-3.5 h-3.5 text-blue-700" />
              Import Updated Excel
            </button>
          </div>

          {/* Table Filters & Stats */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Search Input */}
            <div className="relative w-48">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
              <input
                type="text"
                placeholder="Search products…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full text-xs pl-8 pr-2.5 py-1 border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-orange-500"
              />
            </div>

            {/* Unpriced filter */}
            <label className="flex items-center gap-1.5 text-xs text-slate-600 select-none cursor-pointer">
              <input
                type="checkbox"
                checked={showUnpricedOnly}
                onChange={e => setShowUnpricedOnly(e.target.checked)}
                className="rounded text-orange-600 focus:ring-orange-500"
              />
              Show Unpriced Only
            </label>

            {/* Counter Badges */}
            <div className="flex items-center gap-1.5 text-[11px] font-semibold">
              <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full">
                Total: {items.length}
              </span>
              <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full">
                Priced: {pricedCount}
              </span>
              {unpricedCount > 0 && (
                <span className="px-2 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-full">
                  Unpriced: {unpricedCount}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Main Table Container */}
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-xs text-slate-400">
            <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-orange-500" />
            Loading rate card products…
          </div>
        ) : !selectedClientId ? (
          <div className="p-12 text-center text-slate-400">
            <Building2 className="w-10 h-10 mx-auto mb-2 text-slate-300" />
            <p className="text-sm font-semibold text-slate-600">Please select a Client above</p>
            <p className="text-xs text-slate-400 mt-1">
              Choose a client from the dropdown to load or create their Rate Card.
            </p>
          </div>
        ) : items.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            <FileSpreadsheet className="w-10 h-10 mx-auto mb-2 text-orange-400" />
            <p className="text-sm font-bold text-slate-700">No Products in this Rate Card yet</p>
            <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
              Click <b>"Import All Products"</b> above to instantly populate this client's rate card with all active products from the Master Catalog.
            </p>
            <button
              onClick={handleImportAllProducts}
              disabled={importingProducts}
              className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded-md text-xs font-bold shadow transition-all"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${importingProducts ? "animate-spin" : ""}`} />
              Import All Products Now
            </button>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400">
            No products match your search or filter criteria.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr className="text-slate-500 uppercase text-[10px] font-bold text-left tracking-wider">
                  <th className="px-3 py-2.5 w-12 text-center">#</th>
                  <th className="px-3 py-2.5">Product Name</th>
                  <th className="px-3 py-2.5">Material Code</th>
                  <th className="px-3 py-2.5">Brand</th>
                  <th className="px-3 py-2.5">Unit</th>
                  <th className="px-3 py-2.5 text-right">Catalog Default</th>
                  <th className="px-3 py-2.5 w-44 text-right">Client Rate (₹)</th>
                  <th className="px-3 py-2.5 w-20 text-center">Active</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredItems.map((it, idx) => {
                  const prod = products.find(p => p.id === it.productId);
                  const cardBrand = brands.find(b => b.id === cardBrandId);
                  const isPriced = Number(it.rate) > 0;

                  return (
                    <tr
                      key={it.id}
                      className={`hover:bg-slate-50/80 transition-colors ${
                        !it.isActive ? "opacity-50 bg-slate-50/40" : ""
                      }`}
                    >
                      <td className="px-3 py-2 text-center text-slate-400 text-[11px] font-mono">
                        {idx + 1}
                      </td>

                      {/* Product Name */}
                      <td className="px-3 py-2">
                        <div className="font-semibold text-slate-800">
                          {it.productName || it.itemName || prod?.name}
                        </div>
                        {it.description && (
                          <div className="text-[10px] text-slate-400 truncate max-w-xs">
                            {it.description}
                          </div>
                        )}
                      </td>

                      {/* Material Code */}
                      <td className="px-3 py-2 font-mono text-[11px]">
                        {it.productMaterialCode || it.hsn || prod?.materialCode ? (
                          <span className="px-1.5 py-0.5 bg-orange-50 text-orange-800 rounded font-bold">
                            {it.productMaterialCode || it.hsn || prod?.materialCode}
                          </span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>

                      {/* Brand */}
                      <td className="px-3 py-2 text-slate-600">
                        {cardBrand ? (
                          <span className="px-1.5 py-0.5 bg-slate-100 text-slate-700 rounded text-[10px] font-semibold">
                            {cardBrand.name}
                          </span>
                        ) : (
                          <span className="text-slate-400 text-[10px]">All Brands</span>
                        )}
                      </td>

                      {/* Unit */}
                      <td className="px-3 py-2 text-slate-600 font-medium">
                        {it.uom || it.productUnit || prod?.unit || "pcs"}
                      </td>

                      {/* Catalog Default */}
                      <td className="px-3 py-2 text-right text-slate-400 text-[11px]">
                        ₹{Number(it.productStandardRate || prod?.rate || 0).toLocaleString()}
                      </td>

                      {/* Inline Editable Rate */}
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <span className="text-slate-400 text-xs">₹</span>
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={it.rate === 0 ? "" : it.rate}
                            onChange={e => handleRateChange(it.id, e.target.value)}
                            placeholder="0.00"
                            className={`w-32 text-right text-xs px-2 py-1 border rounded font-mono transition-colors focus:outline-none focus:ring-1 focus:ring-orange-500 ${
                              isPriced
                                ? "border-emerald-300 bg-emerald-50/40 text-emerald-900 font-bold"
                                : "border-slate-300 bg-white text-slate-400"
                            }`}
                          />
                        </div>
                      </td>

                      {/* Active Toggle */}
                      <td className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={it.isActive}
                          onChange={e => handleActiveToggle(it.id, e.target.checked)}
                          className="rounded text-orange-600 focus:ring-orange-500 cursor-pointer h-4 w-4"
                          title={it.isActive ? "Rate is active for lookup" : "Rate is disabled"}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Excel Import Preview Modal */}
      {showImportModal && importSummary && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl border border-slate-200 max-w-2xl w-full p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
                <h3 className="text-sm font-bold text-slate-800">
                  Import Excel Rates — Preview & Validation
                </h3>
              </div>
              <button
                onClick={() => setShowImportModal(false)}
                className="text-slate-400 hover:text-slate-600 font-bold text-lg px-2"
              >
                ×
              </button>
            </div>

            {/* Validation Summary Badges */}
            <div className="grid grid-cols-4 gap-2 text-center text-xs">
              <div className="p-2.5 bg-slate-50 border border-slate-200 rounded">
                <div className="text-slate-400 text-[10px] uppercase font-bold">Total Rows</div>
                <div className="text-base font-bold text-slate-800">{importSummary.total}</div>
              </div>
              <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded">
                <div className="text-emerald-700 text-[10px] uppercase font-bold">To Update</div>
                <div className="text-base font-bold text-emerald-800">{importSummary.updated}</div>
              </div>
              <div className="p-2.5 bg-slate-50 border border-slate-200 rounded">
                <div className="text-slate-400 text-[10px] uppercase font-bold">Unchanged</div>
                <div className="text-base font-bold text-slate-600">{importSummary.unchanged}</div>
              </div>
              <div className="p-2.5 bg-red-50 border border-red-200 rounded">
                <div className="text-red-700 text-[10px] uppercase font-bold">Errors / Skipped</div>
                <div className="text-base font-bold text-red-800">{importSummary.failed}</div>
              </div>
            </div>

            {/* Staged Updates Table */}
            <div className="max-h-60 overflow-y-auto border border-slate-200 rounded text-xs divide-y divide-slate-100">
              <table className="w-full text-left">
                <thead className="bg-slate-50 sticky top-0 text-[10px] font-bold text-slate-500 uppercase">
                  <tr>
                    <th className="px-3 py-1.5">Product</th>
                    <th className="px-3 py-1.5 text-right">Current Rate</th>
                    <th className="px-3 py-1.5 text-right">New Rate</th>
                    <th className="px-3 py-1.5 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {importSummary.stagedRows.map((r, i) => (
                    <tr key={i} className="hover:bg-slate-50">
                      <td className="px-3 py-1.5 font-medium text-slate-800">
                        {r.productName}
                        {r.reason && (
                          <div className="text-[10px] text-red-600">{r.reason}</div>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-right text-slate-400">
                        ₹{Number(r.oldRate).toLocaleString()}
                      </td>
                      <td className="px-3 py-1.5 text-right font-bold font-mono">
                        {r.status === "failed" ? (
                          <span className="text-red-500">—</span>
                        ) : (
                          <span className="text-emerald-700">₹{Number(r.newRate).toLocaleString()}</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-center">
                        {r.status === "updated" ? (
                          <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-800 rounded text-[10px] font-bold">
                            UPDATE
                          </span>
                        ) : r.status === "unchanged" ? (
                          <span className="px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px]">
                            NO CHANGE
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 bg-red-100 text-red-800 rounded text-[10px] font-bold">
                            ERROR
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Modal Actions */}
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                onClick={() => setShowImportModal(false)}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-md"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmImport}
                disabled={saving || importSummary.updated === 0}
                className="flex items-center gap-1.5 px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded-md text-xs font-bold shadow transition-all"
              >
                <Save className="w-3.5 h-3.5" />
                {saving ? "Applying Updates…" : `Apply & Save ${importSummary.updated} Updates`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
