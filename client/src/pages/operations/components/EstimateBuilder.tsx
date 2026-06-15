import React from "react";
import { Pager, usePagedList } from "@/components/Pager";
import { createPortal } from "react-dom";
import { Link } from "wouter";
import { ChevronDown, ChevronRight, ClipboardPaste, Copy, Edit3, Eye, FileSpreadsheet, Filter, FolderOpen, MoveDown, MoveUp, Plus, Redo2, Search, Trash, Undo2 } from "lucide-react";
import { displayFormatLabel, isAblblFormat, normalizeDisplayName, normalizeFormatMode, normalizeGstinPan } from "../../../../../shared/textFormat";
import { formatProductDetails, sameDisplayText } from "../../../../../shared/productDetails";
import { formatCurrency } from "../utils/formatters";
import ProductForm, { type ProductFormValue, emptyProductFormValue } from "./ProductForm";
import { categoryKey, normalizeCategoryLabel } from "./CategoryAutocomplete";
import ClientForm, { type ClientFormValue, emptyClientFormValue } from "./ClientForm";

// ─── Create Product Drawer ───────────────────────────────────────────────────
// Renders as a fixed right-side panel (pointer-events passthrough backdrop so
// the estimator can still see the grid behind it).

const _drawerLabel: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 3 };
const _drawerLabelSpan: React.CSSProperties = { fontSize: 9.5, fontWeight: 700, color: "#64748b", textTransform: "uppercase" as const, letterSpacing: "0.05em" };
const _drawerInput: React.CSSProperties = { border: "1px solid #cbd5e1", fontSize: 11, fontWeight: 600, padding: "3px 6px", color: "#0f172a", background: "#fff", width: "100%", boxSizing: "border-box" as const, borderRadius: 0, fontFamily: "inherit" };

type CreateProductDrawerProps = {
  initialName: string;
  token: string;
  categories: string[];
  hsnCodes: string[];
  onSaveAndUse: (product: any) => void;
  onCancel: () => void;
};

// Compact wrapper around the shared <ProductForm>. Exact same fields and
// validation as Product Master; rendered as a right-side drawer with a
// "Save & Use" footer that immediately attaches the new product to the
// estimate row.
const CreateProductDrawer: React.FC<CreateProductDrawerProps> = ({ initialName, token, categories, hsnCodes, onSaveAndUse, onCancel }) => {
  const [value, setValue] = React.useState<ProductFormValue>(() => ({
    ...emptyProductFormValue(),
    name: initialName,
    rate: "0",
  }));
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const handleSave = async () => {
    const trimmedName = value.name.trim();
    if (!trimmedName) { setError("Product name is required."); return; }
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/operations/products", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: trimmedName,
          description: value.description?.trim() || undefined,
          category: value.category.trim() || undefined,
          hsnSac: value.hsnSac.trim() || undefined,
          unit: value.unit,
          calculationType: value.calculationType,
          gstPercent: Number(value.gstPercent) || 18,
          rate: Number(value.rate) || 0,
          isStandard: value.isStandard,
          defaultSpecification: value.defaultSpecification?.trim() || undefined,
          warranty: value.warranty?.trim() || undefined,
          materialCode: value.materialCode?.trim() || undefined,
          isActive: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 403) setError("Permission denied. Ask an admin or manager to create products.");
        else if (res.status === 400 && String(data.message || "").toLowerCase().includes("unique")) setError(`A product named "${trimmedName}" already exists. Search for it instead.`);
        else setError(data.message || "Failed to create product.");
        return;
      }
      onSaveAndUse(data);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 9500, pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute", top: 0, right: 0, bottom: 0, width: 440,
          background: "#fff", borderLeft: "2px solid #f59e0b",
          boxShadow: "-6px 0 28px rgba(15,23,42,0.16)",
          display: "flex", flexDirection: "column", pointerEvents: "all",
        }}
      >
        <div style={{ background: "#fef3c7", borderBottom: "1px solid #fcd34d", padding: "10px 14px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
          <div>
            <div style={{ fontWeight: 900, fontSize: 12, color: "#78350f" }}>CREATE NEW PRODUCT</div>
            <div style={{ fontSize: 10, color: "#92400e", fontWeight: 600, marginTop: 2 }}>Same form as Product Master · saved + auto-selected in current row</div>
          </div>
          <button type="button" onClick={onCancel} style={{ border: 0, background: "transparent", color: "#92400e", fontSize: 18, lineHeight: 1, cursor: "pointer", padding: 0, flexShrink: 0 }}>×</button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "14px" }}>
          <ProductForm
            value={value}
            onChange={(next) => { setValue(next); setError(""); }}
            categories={categories}
            hsnCodes={hsnCodes}
            compact
          />
          {error && (
            <div style={{ marginTop: 10, color: "#dc2626", fontSize: 11, fontWeight: 700, background: "#fef2f2", border: "1px solid #fecaca", padding: "6px 10px", borderRadius: 4 }}>{error}</div>
          )}
        </div>
        <div style={{ borderTop: "1px solid #e2e8f0", padding: "10px 14px", display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !value.name.trim()}
            style={{ flex: 1, background: saving || !value.name.trim() ? "#e5e7eb" : "#f59e0b", color: saving || !value.name.trim() ? "#9ca3af" : "#1c1917", border: "1px solid #d97706", fontWeight: 900, fontSize: 12, padding: "8px 0", cursor: saving || !value.name.trim() ? "not-allowed" : "pointer", borderRadius: 4 }}
          >
            {saving ? "Saving…" : "Save & Use"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            style={{ background: "#fff", color: "#475569", border: "1px solid #94a3b8", fontWeight: 700, fontSize: 12, padding: "8px 14px", cursor: "pointer", borderRadius: 4 }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

// ─── Create Client Drawer ────────────────────────────────────────────────────
// Mirror of CreateProductDrawer for clients. Uses the shared <ClientForm>
// (same component, fields, validation as Client Master). On save → POST to
// /api/operations/clients → append to local clients list → auto-select.

type CreateClientDrawerProps = {
  initialName: string;
  token: string;
  onSaveAndUse: (client: any) => void;
  onCancel: () => void;
};

const CreateClientDrawer: React.FC<CreateClientDrawerProps> = ({ initialName, token, onSaveAndUse, onCancel }) => {
  const [value, setValue] = React.useState<ClientFormValue>(() => ({
    ...emptyClientFormValue(),
    name: initialName,
  }));
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const handleSave = async () => {
    const trimmedName = value.name.trim();
    if (!trimmedName) { setError("Company name is required."); return; }
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/operations/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: trimmedName,
          groupName: value.groupName.trim() || null,
          gstNumber: value.gst.trim() || null,
          pan: value.pan.trim() || null,
          type: value.type || "corporate",
          format: value.formatSetting || "normal",
          email: value.email.trim() || null,
          phone: value.phone.trim() || null,
          city: value.city.trim() || null,
          address: value.address.trim() || null,
          primaryContact: value.primaryContact.trim() || null,
          paymentTerms: value.paymentTerms.trim() || null,
          vendorCode: value.vendorCode.trim() || null,
          isActive: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 403) setError("Permission denied. Ask an admin or manager to create clients.");
        else if (res.status === 400 && String(data.message || "").toLowerCase().includes("unique")) setError(`A client named "${trimmedName}" already exists. Search for it instead.`);
        else setError(data.message || "Failed to create client.");
        return;
      }
      onSaveAndUse(data);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 9500, pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute", top: 0, right: 0, bottom: 0, width: 560,
          background: "#fff", borderLeft: "2px solid #f59e0b",
          boxShadow: "-6px 0 28px rgba(15,23,42,0.16)",
          display: "flex", flexDirection: "column", pointerEvents: "all",
        }}
      >
        <div style={{ background: "#fef3c7", borderBottom: "1px solid #fcd34d", padding: "10px 14px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
          <div>
            <div style={{ fontWeight: 900, fontSize: 12, color: "#78350f" }}>CREATE NEW CLIENT</div>
            <div style={{ fontSize: 10, color: "#92400e", fontWeight: 600, marginTop: 2 }}>Same form as Client Master · saved + auto-selected in this estimate</div>
          </div>
          <button type="button" onClick={onCancel} style={{ border: 0, background: "transparent", color: "#92400e", fontSize: 18, lineHeight: 1, cursor: "pointer", padding: 0, flexShrink: 0 }}>×</button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "14px" }}>
          <ClientForm value={value} onChange={(next) => { setValue(next); setError(""); }} />
          {error && (
            <div style={{ marginTop: 10, color: "#dc2626", fontSize: 11, fontWeight: 700, background: "#fef2f2", border: "1px solid #fecaca", padding: "6px 10px", borderRadius: 4 }}>{error}</div>
          )}
        </div>
        <div style={{ borderTop: "1px solid #e2e8f0", padding: "10px 14px", display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !value.name.trim()}
            style={{ flex: 1, background: saving || !value.name.trim() ? "#e5e7eb" : "#f59e0b", color: saving || !value.name.trim() ? "#9ca3af" : "#1c1917", border: "1px solid #d97706", fontWeight: 900, fontSize: 12, padding: "8px 0", cursor: saving || !value.name.trim() ? "not-allowed" : "pointer", borderRadius: 4 }}
          >
            {saving ? "Saving…" : "Save & Use"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            style={{ background: "#fff", color: "#475569", border: "1px solid #94a3b8", fontWeight: 700, fontSize: 12, padding: "8px 14px", cursor: "pointer", borderRadius: 4 }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

// ─── Client Search Cell ──────────────────────────────────────────────────────
// Typeahead picker for clients with "+ Create New Client" affordance. Same
// pattern as ProductSearchCell — opens the shared <ClientForm> drawer when
// no match exists.

type ClientSearchCellProps = {
  clients: any[];
  value: string;          // selected client id as string
  onSelect: (clientId: string) => void;
  onCreateNew: (name: string) => void;
  required?: boolean;
  autoFocus?: boolean;
};

const ClientSearchCell: React.FC<ClientSearchCellProps> = ({ clients, value, onSelect, onCreateNew, required, autoFocus }) => {
  const selected = clients.find(c => String(c.id) === String(value || ""));
  const [query, setQuery] = React.useState(selected?.name || "");
  const [open, setOpen] = React.useState(false);
  const [highlightedIndex, setHighlightedIndex] = React.useState(0);
  const wrapperRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    setQuery(selected?.name || "");
  }, [selected?.name, value]);

  React.useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const q = query.trim().toLowerCase();
  const matches = clients
    .filter((c: any) => c.isActive)
    .filter((c: any) => !q || (c.name || "").toLowerCase().includes(q) || (c.groupName || "").toLowerCase().includes(q))
    .slice(0, 12);
  const showCreate = q.length > 1 && matches.length === 0;

  const pick = (c: any) => {
    onSelect(String(c.id));
    setQuery(c.name);
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") { setOpen(false); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      if (matches.length === 0) return;
      setHighlightedIndex(prev => {
        const delta = e.key === "ArrowDown" ? 1 : -1;
        return (prev + delta + matches.length) % matches.length;
      });
      return;
    }
    if (e.key === "Enter") {
      if (showCreate) { e.preventDefault(); setOpen(false); onCreateNew(query.trim()); return; }
      const m = matches[highlightedIndex];
      if (m) { e.preventDefault(); pick(m); }
    }
  };

  return (
    <div ref={wrapperRef} style={{ position: "relative" }}>
      <input
        type="text"
        required={required}
        autoFocus={autoFocus}
        value={query}
        placeholder="Search clients or type a new name…"
        onFocus={() => { setOpen(true); setHighlightedIndex(0); }}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setHighlightedIndex(0); if (!e.target.value) onSelect(""); }}
        onKeyDown={handleKeyDown}
      />
      {open && (matches.length > 0 || showCreate) && (
        <div style={{
          position: "absolute", zIndex: 1000, top: "100%", left: 0, right: 0,
          background: "#fff", border: "1px solid #cbd5e1", boxShadow: "0 8px 18px rgba(15,23,42,0.14)",
          maxHeight: 280, overflowY: "auto", marginTop: 2,
        }}>
          {matches.map((c: any, idx) => (
            <button
              key={c.id}
              type="button"
              tabIndex={-1}
              onMouseDown={(e) => { e.preventDefault(); pick(c); }}
              onMouseEnter={() => setHighlightedIndex(idx)}
              style={{
                display: "block", width: "100%", textAlign: "left", padding: "6px 10px",
                border: 0, borderBottom: "1px solid #e2e8f0",
                background: highlightedIndex === idx ? "#fff7ed" : "#fff",
                cursor: "pointer", fontSize: 12, fontWeight: 700, color: "#0f172a",
              }}
            >
              <span style={{ display: "block" }}>{c.name}</span>
              {c.groupName && <span style={{ display: "block", fontSize: 10, color: "#64748b", fontWeight: 500 }}>{c.groupName}</span>}
            </button>
          ))}
          {showCreate && (
            <button
              type="button"
              tabIndex={-1}
              onMouseDown={(e) => { e.preventDefault(); setOpen(false); onCreateNew(query.trim()); }}
              style={{
                display: "block", width: "100%", textAlign: "left", padding: "8px 10px",
                border: 0, background: "#f0fdf4", cursor: "pointer",
                fontSize: 12, fontWeight: 800, color: "#166534", lineHeight: 1.3,
              }}
            >
              <span style={{ display: "block", fontSize: 9.5, fontWeight: 700, color: "#4ade80", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 2 }}>Not found in master</span>
              + Create New Client &ldquo;{query.trim()}&rdquo;
            </button>
          )}
        </div>
      )}
    </div>
  );
};

// ─── Product Search Cell ──────────────────────────────────────────────────────

type ProductSearchCellProps = {
  item: any;
  rowIndex: number;
  productOptions: Array<{ product: any; searchName: string }>;
  onSelect: (index: number, productId: string) => void;
  onDetailsChange: (index: number, value: string) => void;
  readOnly?: boolean;
  cellKey?: string;
  onFocus?: () => void;
  onDoubleClick?: () => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  onCreateProduct?: (name: string) => void;
};

const ProductSearchCell: React.FC<ProductSearchCellProps> = ({
  item,
  rowIndex,
  productOptions,
  onSelect,
  onDetailsChange,
  readOnly = false,
  cellKey,
  onFocus,
  onDoubleClick,
  onKeyDown,
  onCreateProduct,
}) => {
  const selectedProduct = productOptions.find(({ product }) => String(product.id) === String(item.productId || ""))?.product;
  const savedDetails = sameDisplayText(item.description, item.itemName) ? "" : item.description || "";
  const displayValue = savedDetails || (selectedProduct ? formatProductDetails(selectedProduct, "", item.itemName) : "");
  const [query, setQuery] = React.useState(displayValue);
  const [open, setOpen] = React.useState(false);
  const [highlightedIndex, setHighlightedIndex] = React.useState(0);
  const wrapperRef = React.useRef<HTMLDivElement | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const dropdownRef = React.useRef<HTMLDivElement | null>(null);
  const [dropdownRect, setDropdownRect] = React.useState({ top: 0, left: 0, width: 420, maxHeight: 260 });

  React.useEffect(() => {
    setQuery(displayValue);
  }, [displayValue, item.productId]);

  React.useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        wrapperRef.current
        && !wrapperRef.current.contains(target)
        && dropdownRef.current
        && !dropdownRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  const matches = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return productOptions
      .filter(({ searchName }) => !q || searchName.includes(q))
      .slice(0, 30);
  }, [productOptions, query]);

  React.useEffect(() => {
    if (highlightedIndex >= matches.length) setHighlightedIndex(0);
  }, [highlightedIndex, matches.length]);

  const updateDropdownRect = React.useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    const rect = input.getBoundingClientRect();
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const minWidth = Math.max(rect.width, 420);
    const width = Math.min(Math.max(minWidth, rect.width), Math.max(260, viewportWidth - 24));
    const left = Math.min(Math.max(12, rect.left), Math.max(12, viewportWidth - width - 12));
    const spaceBelow = viewportHeight - rect.bottom - 12;
    const spaceAbove = rect.top - 12;
    const openAbove = spaceBelow < 180 && spaceAbove > spaceBelow;
    const maxHeight = Math.max(160, Math.min(320, openAbove ? spaceAbove : spaceBelow));
    const top = openAbove ? Math.max(12, rect.top - maxHeight - 4) : rect.bottom + 4;
    setDropdownRect({ top, left, width, maxHeight });
  }, []);

  React.useEffect(() => {
    if (!open) return;
    updateDropdownRect();
    window.addEventListener("resize", updateDropdownRect);
    window.addEventListener("scroll", updateDropdownRect, true);
    return () => {
      window.removeEventListener("resize", updateDropdownRect);
      window.removeEventListener("scroll", updateDropdownRect, true);
    };
  }, [open, updateDropdownRect, query, matches.length]);

  const selectProduct = (product: any) => {
    setQuery(formatProductDetails(product, "", item.itemName) || product.name);
    setOpen(false);
    onSelect(rowIndex, String(product.id));
  };

  const showCreateOption = !readOnly && !!onCreateProduct && query.trim().length > 1 && matches.length === 0;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (readOnly) {
      onKeyDown?.(event);
      return;
    }
    if (event.key === "Escape") {
      setOpen(false);
      onKeyDown?.(event);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      if (matches.length === 0) return;
      setHighlightedIndex(prev => {
        const delta = event.key === "ArrowDown" ? 1 : -1;
        return (prev + delta + matches.length) % matches.length;
      });
      return;
    }
    // Enter/Tab on the "Create Product" option when dropdown shows it
    if (showCreateOption && open && (event.key === "Enter" || (event.key === "Tab" && !event.shiftKey))) {
      event.preventDefault();
      setOpen(false);
      onCreateProduct!(query.trim());
      return;
    }
    const highlighted = open ? matches[highlightedIndex]?.product : null;
    if (!highlighted) {
      onKeyDown?.(event);
      return;
    }
    if (event.key === "Enter") {
      selectProduct(highlighted);
      onKeyDown?.(event);
      return;
    }
    if (event.key === "Tab" && !event.shiftKey) {
      selectProduct(highlighted);
      onKeyDown?.(event);
      return;
    }
    onKeyDown?.(event);
  };

  return (
    <div ref={wrapperRef} style={{ position: "relative" }}>
      <input
        ref={inputRef}
        type="text"
        data-est-product-index={rowIndex}
        data-cell-key={cellKey}
        readOnly={readOnly}
        value={query}
        onFocus={() => {
          onFocus?.();
          if (!readOnly) setOpen(true);
          setHighlightedIndex(0);
        }}
        onDoubleClick={onDoubleClick}
        onChange={(e) => {
          if (readOnly) return;
          const value = e.target.value;
          setQuery(value);
          setOpen(true);
          setHighlightedIndex(0);
          onDetailsChange(rowIndex, value);
        }}
        onKeyDown={handleKeyDown}
        placeholder="Search product details"
        style={{ fontWeight: 600 }}
      />
      {open && createPortal((
        <div
          ref={dropdownRef}
          style={{
            position: "fixed",
            zIndex: 10000,
            top: dropdownRect.top,
            left: dropdownRect.left,
            width: dropdownRect.width,
            maxHeight: dropdownRect.maxHeight,
            overflowY: "auto",
            overscrollBehavior: "contain",
            background: "#fff",
            border: "1px solid #94a3b8",
            boxShadow: "0 8px 18px rgba(15, 23, 42, 0.18)",
          }}
        >
          {matches.length > 0 ? matches.map(({ product: p }, optionIndex) => (
            <button
              key={p.id}
              type="button"
              tabIndex={-1}
              id={`product-option-${rowIndex}-${optionIndex}`}
              onMouseDown={(e) => {
                e.preventDefault();
                selectProduct(p);
              }}
              onMouseEnter={() => setHighlightedIndex(optionIndex)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "5px 8px",
                border: 0,
                borderBottom: "1px solid #e2e8f0",
                background: highlightedIndex === optionIndex || String(item.productId || "") === String(p.id) ? "#fff7ed" : "#fff",
                cursor: "pointer",
                fontSize: 11,
                fontWeight: 700,
                color: "#0f172a",
                lineHeight: "15px",
              }}
            >
              <span style={{ display: "block" }}>{p.name}</span>
              <span style={{ display: "block", color: "#64748b", fontWeight: 600, whiteSpace: "normal" }}>
                {p.description || p.defaultSpecification || ""}
              </span>
            </button>
          )) : showCreateOption ? (
            <button
              type="button"
              tabIndex={-1}
              onMouseDown={(e) => {
                e.preventDefault();
                setOpen(false);
                onCreateProduct!(query.trim());
              }}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "7px 10px",
                border: 0,
                background: "#f0fdf4",
                cursor: "pointer",
                fontSize: 11,
                fontWeight: 800,
                color: "#166534",
                lineHeight: "16px",
              }}
            >
              <span style={{ display: "block", fontSize: 9.5, fontWeight: 700, color: "#4ade80", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 2 }}>Not found in master</span>
              + Create Product &ldquo;{query.trim()}&rdquo;
            </button>
          ) : (
            <div style={{ padding: "7px 8px", color: "#94a3b8", fontSize: 11 }}>No matching products</div>
          )}
        </div>
      ), document.body)}
    </div>
  );
};

const nearestStandardSize = (value: string) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  const remainder = numeric % 6;
  if (remainder === 0) return null;
  const lower = numeric - remainder;
  return remainder === 1 ? lower : lower + 6;
};

const SmartSizeInput: React.FC<{
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  cellKey?: string;
  onFocus?: () => void;
  onDoubleClick?: () => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
}> = ({ value, onChange, readOnly = false, cellKey, onFocus, onDoubleClick, onKeyDown }) => {
  const [open, setOpen] = React.useState(false);
  const suggestion = nearestStandardSize(value);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [rect, setRect] = React.useState({ top: 0, left: 0 });

  const acceptSuggestion = () => {
    if (suggestion == null) return;
    onChange(String(suggestion));
    setOpen(false);
  };

  // Anchor the floating suggestion below the input. We use position:fixed +
  // createPortal so the dropdown escapes the .eb-grid td { overflow: hidden }
  // clipping that was hiding it behind subsequent estimate rows.
  const updateRect = React.useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setRect({ top: r.bottom, left: r.left });
  }, []);

  React.useEffect(() => {
    if (!open) return;
    updateRect();
    window.addEventListener("scroll", updateRect, true);
    window.addEventListener("resize", updateRect);
    return () => {
      window.removeEventListener("scroll", updateRect, true);
      window.removeEventListener("resize", updateRect);
    };
  }, [open, updateRect, value]);

  return (
    <div style={{ position: "relative" }}>
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        data-cell-key={cellKey}
        value={value}
        readOnly={readOnly}
        onFocus={() => {
          onFocus?.();
          if (!readOnly) setOpen(true);
        }}
        onDoubleClick={onDoubleClick}
        onChange={(e) => {
          if (readOnly) return;
          onChange(e.target.value);
          setOpen(true);
        }}
        onBlur={() => window.setTimeout(() => setOpen(false), 100)}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.defaultPrevented) return;
          if (event.key === "Escape") {
            setOpen(false);
            return;
          }
          if (readOnly) return;
          if (!open || suggestion == null) return;
          if (event.key === "Enter" || event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            acceptSuggestion();
            return;
          }
          if (event.key === "Tab" && !event.shiftKey) {
            acceptSuggestion();
          }
        }}
      />
      {open && suggestion != null && createPortal((
        <button
          type="button"
          tabIndex={-1}
          onMouseDown={(e) => {
            e.preventDefault();
            acceptSuggestion();
          }}
          style={{
            position: "fixed",
            zIndex: 10000,
            top: rect.top + 2,
            left: rect.left,
            minWidth: 86,
            border: "1px solid #f59e0b",
            background: "#fffbeb",
            color: "#92400e",
            padding: "3px 6px",
            fontSize: 10,
            fontWeight: 800,
            textAlign: "left",
            whiteSpace: "nowrap",
            boxShadow: "0 4px 10px rgba(15, 23, 42, 0.12)",
          }}
        >
          Use {suggestion}
        </button>
      ), document.body)}
    </div>
  );
};

type EstimateGridColumnId =
  | "select"
  | "sl"
  | "element"
  | "materialCode"
  | "hsn"
  | "standard"
  | "product"
  | "width"
  | "height"
  | "quantity"
  | "sqft"
  | "rate"
  | "amount"
  | "gstPercent"
  | "gstAmount"
  | "cgstPercent"
  | "cgstAmount"
  | "total";

type EstimateGridColumn = {
  id: EstimateGridColumnId;
  label: string;
  width: number;
  minWidth: number;
  fixed?: boolean;
  optional?: "materialCode" | "standard";
};

const ESTIMATE_GRID_PREF_KEY = "sunrise.estimateGrid.v2.columns";
const BASE_ESTIMATE_COLUMNS: EstimateGridColumn[] = [
  { id: "select", label: "", width: 30, minWidth: 30, fixed: true },
  { id: "sl", label: "Row No", width: 58, minWidth: 48, fixed: true },
  { id: "element", label: "Element", width: 170, minWidth: 120, fixed: true },
  { id: "product", label: "Product Details", width: 240, minWidth: 160, fixed: true },
  { id: "materialCode", label: "Material Code", width: 118, minWidth: 92, optional: "materialCode" },
  { id: "hsn", label: "HSN", width: 74, minWidth: 60 },
  { id: "standard", label: "Standard", width: 88, minWidth: 72, optional: "standard" },
  { id: "width", label: "W", width: 62, minWidth: 50 },
  { id: "height", label: "H", width: 62, minWidth: 50 },
  { id: "quantity", label: "Qty", width: 64, minWidth: 54 },
  { id: "sqft", label: "T.Sqft", width: 76, minWidth: 62 },
  { id: "rate", label: "Rate", width: 90, minWidth: 72 },
  { id: "amount", label: "Amount", width: 96, minWidth: 78 },
  { id: "gstPercent", label: "GST %", width: 64, minWidth: 54 },
  { id: "gstAmount", label: "GST Amt", width: 88, minWidth: 72 },
  { id: "cgstPercent", label: "CGST %", width: 68, minWidth: 56 },
  { id: "cgstAmount", label: "CGST Amt", width: 92, minWidth: 74 },
  { id: "total", label: "Total", width: 100, minWidth: 82 },
];

const getStoredEstimateGridPrefs = () => {
  if (typeof window === "undefined") return null;
  try {
    return JSON.parse(window.localStorage.getItem(ESTIMATE_GRID_PREF_KEY) || "null") as {
      order?: EstimateGridColumnId[];
      widths?: Partial<Record<EstimateGridColumnId, number>>;
    } | null;
  } catch {
    return null;
  }
};

const buildEstimateColumns = (
  showMaterialCodeColumn: boolean,
  showStandardColumn: boolean,
  prefs = getStoredEstimateGridPrefs(),
) => {
  const available = BASE_ESTIMATE_COLUMNS.filter(col => {
    if (col.optional === "materialCode") return showMaterialCodeColumn;
    if (col.optional === "standard") return showStandardColumn;
    return true;
  });
  const byId = new Map(available.map(col => [col.id, col]));
  const fixedIds = available.filter(col => col.fixed).map(col => col.id);
  const storedOrder = (prefs?.order || []).filter(id => byId.has(id) && !fixedIds.includes(id));
  const orderedIds = [
    ...fixedIds,
    ...storedOrder,
    ...available.map(col => col.id).filter(id => !fixedIds.includes(id) && !storedOrder.includes(id)),
  ];
  return orderedIds.map(id => {
    const base = byId.get(id)!;
    const storedWidth = prefs?.widths?.[id];
    return {
      ...base,
      width: Math.max(base.minWidth, Number(storedWidth) || base.width),
    };
  });
};

type EstimateBuilderProps = {
  [key: string]: any;
  estimates: any[];
  clients: any[];
  brands: any[];
  challans: any[];
  invoices: any[];
  stores: any[];
  estItems: any[];
  clientBillingProfilesList: any[];
  products: any[];
  addPackingItem: (storeId: string) => void;
  addInstallationItem: (storeId: string) => void;
  addTransportItem: (storeId: string, mode?: "local" | "outstation") => void;
  copyEstimateItemToClipboard: (indexes: number[]) => void;
  rowClipboard: any;
  setMessage: (msg: string) => void;
};

const EstimateBuilder: React.FC<EstimateBuilderProps> = (props) => {
  const [storeSearch, setStoreSearch] = React.useState("");
  const [pendingStoreIds, setPendingStoreIds] = React.useState<string[]>([]);
  const [gstProfileSearch, setGstProfileSearch] = React.useState("");
  const [gstProfileOpen, setGstProfileOpen] = React.useState(false);
  const [gstProfileHighlightIndex, setGstProfileHighlightIndex] = React.useState(0);
  const [storePickerOpen, setStorePickerOpen] = React.useState(false);
  const [storeHighlightIndex, setStoreHighlightIndex] = React.useState(0);
  const [manualStoreName, setManualStoreName] = React.useState("");
  const [manualStoreLocation, setManualStoreLocation] = React.useState("");
  const [pendingProductFocusIndex, setPendingProductFocusIndex] = React.useState<number | null>(null);
  const [pendingElementFocusIndex, setPendingElementFocusIndex] = React.useState<number | null>(null);
  const [selectedRowIndexes, setSelectedRowIndexes] = React.useState<number[]>([]);
  const [rowFilterElement, setRowFilterElement] = React.useState("");
  const [rowFilterProduct, setRowFilterProduct] = React.useState("");
  const [rowFilterStore, setRowFilterStore] = React.useState("");
  const [rowFilterCity, setRowFilterCity] = React.useState("");
  const [columnPrefs, setColumnPrefs] = React.useState(() => getStoredEstimateGridPrefs() || {});
  const [activeCell, setActiveCell] = React.useState<{ rowIndex: number; columnId: EstimateGridColumnId } | null>(null);
  const [editingCell, setEditingCell] = React.useState<{ rowIndex: number; columnId: EstimateGridColumnId } | null>(null);
  const [cellDrafts, setCellDrafts] = React.useState<Record<string, string>>({});
  const [dragColumnId, setDragColumnId] = React.useState<EstimateGridColumnId | null>(null);
  const [collapsedStoreIds, setCollapsedStoreIds] = React.useState<string[]>([]);
  const [renamingStoreId, setRenamingStoreId] = React.useState<string | null>(null);
  const [renamingStoreName, setRenamingStoreName] = React.useState("");
  const [findText, setFindText] = React.useState("");
  const [replaceText, setReplaceText] = React.useState("");
  const [showFilters, setShowFilters] = React.useState(true);
  const [headerExpanded, setHeaderExpanded] = React.useState(true);
  const [undoStack, setUndoStack] = React.useState<any[][]>([]);
  const [redoStack, setRedoStack] = React.useState<any[][]>([]);
  const lastSelectionAnchorRef = React.useRef<number | null>(null);
  const [createProductFor, setCreateProductFor] = React.useState<{
    rowIndex: number;
    initialName: string;
  } | null>(null);
  const [createClientFor, setCreateClientFor] = React.useState<{ initialName: string } | null>(null);

  const {
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
    estTitle,
    setEstTitle,
    estItems,
    setEstItems,
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
    pastePreviewRows = [],
    setPastePreviewRows,
    products,
    handleProductSelectChange,
    handleEstimateItemChange,
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
    rowClipboard,
    isSaving,
    sellerProfile,
  } = props;

  // Phase 2: register pagination at the render layer. Full lists are still
  // loaded (the register's per-row Linked-Docs lookups and the workflow logic
  // need them); only DOM rows are paged, so all filters/search behave exactly
  // as before while large registers stop rendering thousands of rows.
  const estimateListFiltered = React.useMemo(() => estimates.filter((e: any) => {
    if (estimateStatusFilter !== "all" && e.status !== estimateStatusFilter) return false;
    const q = estimateSearch.trim().toLowerCase();
    if (!q) return true;
    const client = clients.find((c: any) => c.id === e.clientId);
    return (
      (e.estimateNumber || "").toLowerCase().includes(q)
      || (e.title || "").toLowerCase().includes(q)
      || (client?.name || "").toLowerCase().includes(q)
      || (e.poNumber || "").toLowerCase().includes(q)
    );
  }), [estimates, clients, estimateSearch, estimateStatusFilter]);
  const estListPager = usePagedList(estimateListFiltered, 25);

  React.useEffect(() => {
    setSelectedRowIndexes(prev => prev.filter(index => index >= 0 && index < estItems.length));
  }, [estItems.length]);

  React.useEffect(() => {
    if (!showEstimateForm) return;
    // New estimate: open header so user can fill Client/Date immediately.
    // Editing: collapse header so the grid is visible by default.
    setHeaderExpanded(!editingEstimateId);
    setShowFilters(false);
  }, [showEstimateForm, editingEstimateId]);

  const recalcRows = React.useCallback((rows: any[]) => {
    return typeof recalculateEstimateRows === "function"
      ? recalculateEstimateRows(rows, estGstType)
      : rows;
  }, [recalculateEstimateRows, estGstType]);

  const applyGridMutation = React.useCallback((mutator: (rows: any[]) => any[], trackHistory = true) => {
    setEstItems((prev: any[]) => {
      const next = mutator(prev.map(row => ({ ...row })));
      if (trackHistory) {
        setUndoStack(stack => [...stack.slice(-24), prev.map(row => ({ ...row }))]);
        setRedoStack([]);
      }
      return recalcRows(next);
    });
  }, [recalcRows, setEstItems]);

  const selectSingleRow = (index: number) => {
    if (index < 0) return;
    setSelectedRowIndexes([index]);
    lastSelectionAnchorRef.current = index;
  };

  const toggleRowSelection = (index: number) => {
    if (index < 0) return;
    setSelectedRowIndexes(prev => (
      prev.includes(index)
        ? prev.filter(i => i !== index)
        : [...prev, index].sort((a, b) => a - b)
    ));
    lastSelectionAnchorRef.current = index;
  };

  const selectRowRange = (index: number) => {
    const anchor = lastSelectionAnchorRef.current ?? selectedRowIndexes[0] ?? index;
    const start = Math.min(anchor, index);
    const end = Math.max(anchor, index);
    setSelectedRowIndexes(Array.from({ length: end - start + 1 }, (_, offset) => start + offset));
  };

  const copySelectedRows = () => {
    const indexes = selectedRowIndexes.filter(index => estItems[index]);
    if (indexes.length === 0) return;
    copyEstimateItemToClipboard(indexes);
    const text = indexes.map(rowIndex => {
      const row = estItems[rowIndex];
      return [
        row.itemName || "",
        row.description || "",
        row.quantity || "",
        row.width || "",
        row.height || "",
        row.rate || "",
      ].join("\t");
    }).join("\n");
    window.navigator.clipboard?.writeText(text).catch(() => {});
  };

  const pasteAfterSelection = () => {
    const index = selectedRowIndexes[selectedRowIndexes.length - 1];
    if (index == null) return;
    if (!rowClipboard || (rowClipboard as any[]).length === 0) return;
    const clipRows = rowClipboard as any[];
    // Use the target row's storeId so pasted rows land in the right store
    const targetStoreId = estItems[index]?.storeId ?? clipRows[0]?.storeId;
    applyGridMutation(rows => [
      ...rows.slice(0, index + 1),
      ...clipRows.map(r => ({ ...r, storeId: targetStoreId })),
      ...rows.slice(index + 1),
    ]);
  };

  const addRowBelowSelection = () => {
    const baseIndex = selectedRowIndexes[selectedRowIndexes.length - 1] ?? activeCell?.rowIndex ?? estItems.length - 1;
    const baseRow = estItems[baseIndex];
    const sid = String(baseRow?.storeId || estItems[0]?.storeId || "");
    if (!sid) return;
    const insertAt = Math.min(estItems.length, Math.max(0, baseIndex + 1));
    applyGridMutation(rows => [
      ...rows.slice(0, insertAt),
      blankRowForStore(sid, rows.length + 1, estGstType),
      ...rows.slice(insertAt),
    ]);
    setSelectedRowIndexes([insertAt]);
    window.requestAnimationFrame(() => focusCell(insertAt, "element", true));
  };

  const undoGridChange = () => {
    setUndoStack(stack => {
      const previous = stack[stack.length - 1];
      if (!previous) return stack;
      setRedoStack(redo => [...redo.slice(-24), estItems.map((row: any) => ({ ...row }))]);
      setEstItems(recalcRows(previous.map(row => ({ ...row }))));
      return stack.slice(0, -1);
    });
  };

  const redoGridChange = () => {
    setRedoStack(stack => {
      const nextRows = stack[stack.length - 1];
      if (!nextRows) return stack;
      setUndoStack(undo => [...undo.slice(-24), estItems.map((row: any) => ({ ...row }))]);
      setEstItems(recalcRows(nextRows.map(row => ({ ...row }))));
      return stack.slice(0, -1);
    });
  };

  const duplicateSelectedRows = () => {
    const indexes = selectedRowIndexes.filter(index => estItems[index]);
    if (indexes.length === 0) return;
    applyGridMutation(rows => {
      const selected = new Set(indexes);
      const next: any[] = [];
      rows.forEach((row, index) => {
        next.push(row);
        if (selected.has(index)) next.push({ ...row });
      });
      return next;
    });
  };

  const deleteSelectedRowsAction = () => {
    if (selectedRowIndexes.length === 0) return;
    applyGridMutation(rows => rows.filter((_: any, index: number) => !selectedRowIndexes.includes(index)));
    setSelectedRowIndexes([]);
  };

  const persistColumnPrefs = React.useCallback((next: { order?: EstimateGridColumnId[]; widths?: Partial<Record<EstimateGridColumnId, number>> }) => {
    setColumnPrefs(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ESTIMATE_GRID_PREF_KEY, JSON.stringify(next));
    }
  }, []);

  const editableColumnIds = React.useMemo<EstimateGridColumnId[]>(() => ([
    "element", "hsn", "standard", "product", "width", "height", "quantity", "rate"
  ]), []);

  const getCellKey = (rowIndex: number, columnId: EstimateGridColumnId) => `${rowIndex}:${columnId}`;

  const focusCell = (rowIndex: number, columnId: EstimateGridColumnId, edit = false, cursorMode: "select-all" | "end" = "select-all") => {
    if (rowIndex < 0) return;
    setActiveCell({ rowIndex, columnId });
    if (edit && editableColumnIds.includes(columnId)) setEditingCell({ rowIndex, columnId });
    window.requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-cell-key="${getCellKey(rowIndex, columnId)}"]`);
      el?.focus();
      if (edit && el instanceof HTMLInputElement) {
        if (cursorMode === "end") {
          const len = el.value.length;
          el.setSelectionRange(len, len);
        } else {
          el.select();
        }
      }
      if (edit && el instanceof HTMLTextAreaElement) el.select();
    });
  };

  // Begin editing a cell. When triggerChar is provided (user typed a printable key
  // to start editing), pre-set that character as the draft so it isn't swallowed,
  // and position the cursor at the end instead of selecting all.
  const beginEditCell = (rowIndex: number, columnId: EstimateGridColumnId, triggerChar?: string) => {
    if (!editableColumnIds.includes(columnId)) return;
    if (triggerChar !== undefined && columnId !== "product") {
      setCellDrafts(prev => ({ ...prev, [getCellKey(rowIndex, columnId)]: triggerChar }));
    }
    setEditingCell({ rowIndex, columnId });
    focusCell(rowIndex, columnId, true, triggerChar !== undefined ? "end" : "select-all");
  };

  const stopEditCell = () => {
    setEditingCell(null);
  };

  const cancelEditCell = (rowIndex: number, columnId: EstimateGridColumnId) => {
    setCellDrafts(prev => {
      const next = { ...prev };
      delete next[getCellKey(rowIndex, columnId)];
      return next;
    });
    setEditingCell(null);
  };

  const isEditingCell = (rowIndex: number, columnId: EstimateGridColumnId) =>
    editingCell?.rowIndex === rowIndex && editingCell.columnId === columnId;

  const isActiveCell = (rowIndex: number, columnId: EstimateGridColumnId) =>
    activeCell?.rowIndex === rowIndex && activeCell.columnId === columnId;

  const storeDisplay = (store: any) => {
    const code = store.storeCode ? `${store.storeCode} — ` : "";
    const place = [store.city, store.state].filter(Boolean).join(", ");
    return `${code}${store.name}${place ? ` | ${place}` : ""}`;
  };

  const storeDisplayById = (storeId: string) => {
    const store = stores.find((s: any) => String(s.id) === String(storeId));
    if (store) return storeDisplay(store);
    const override = estStoreOverrides?.[storeId] || {};
    const place = [override.storeCity, override.storeState].filter(Boolean).join(", ");
    return `${override.storeName || `#${storeId}`}${place ? ` | ${place}` : ""}`;
  };

  const productOptions = React.useMemo(() => products
    .filter((p: any) => p.isActive)
    .map((product: any) => ({
      product,
      searchName: [
        product.name,
        product.description,
        product.defaultSpecification,
        product.hsnSac,
      ].filter(Boolean).join(" ").toLowerCase(),
    })), [products]);

  const canCreateProduct = ["admin", "manager", "designer"].includes(props.userRole || "");

  // Derived lists for the shared ProductForm's category + HSN autocompletes.
  // Same derivation rule as ProductsPanel so the two screens always show the
  // same suggestions.
  const productCategories = React.useMemo(() => {
    const byKey = new Map<string, string>();
    products.forEach((p: any) => {
      const label = normalizeCategoryLabel(p.category);
      if (!label) return;
      const k = categoryKey(label);
      if (!byKey.has(k)) byKey.set(k, label);
    });
    return Array.from(byKey.values()).sort((a, b) => a.localeCompare(b));
  }, [products]);

  const productHsnCodes = React.useMemo(() => {
    const byKey = new Map<string, string>();
    products.forEach((p: any) => {
      const label = String(p.hsnSac ?? "").trim().toUpperCase();
      if (!label) return;
      const k = categoryKey(label);
      if (!byKey.has(k)) byKey.set(k, label);
    });
    return Array.from(byKey.values()).sort((a, b) => a.localeCompare(b));
  }, [products]);

  const handleOpenCreateProduct = React.useCallback((rowIndex: number, name: string) => {
    setCreateProductFor({ rowIndex, initialName: name });
  }, []);

  // SAFETY RULE — when a new product is attached to an existing row:
  //   ALLOWED to set: productId, unit, calculationType, hsn, isStandard.
  //   NEVER overwrite: description, rate, width, height, quantity, sqft, amount,
  //   sgst*, cgst*, igst*, totalAmount, gstPercent. The spread `...item` keeps
  //   them; we do NOT call recalculateEstimateRows so totals stay frozen as the
  //   estimator entered them.
  const handleProductCreatedAndUse = React.useCallback((newProduct: any) => {
    if (!createProductFor) return;
    const { rowIndex } = createProductFor;
    if (props.setProducts) {
      props.setProducts((prev: any[]) => [...prev, newProduct]);
    }
    setEstItems((prev: any[]) => prev.map((item: any, i: number) => {
      if (i !== rowIndex) return item;
      return {
        ...item,
        productId: String(newProduct.id),
        unit: newProduct.unit || item.unit,
        calculationType: newProduct.calculationType || item.calculationType,
        hsn: newProduct.hsnSac || item.hsn,
        isStandard: newProduct.isStandard ?? item.isStandard,
      };
    }));
    setCreateProductFor(null);
    window.requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>(`input[data-est-product-index="${rowIndex}"]`);
      input?.focus();
    });
  }, [createProductFor, props, setEstItems]);

  // Append a newly-created client to the local clients list and auto-select
  // it in the estimate. Mirrors handleProductCreatedAndUse: no full data
  // refetch — the parent's setClients keeps the dropdown in sync immediately.
  const handleClientCreatedAndUse = React.useCallback((newClient: any) => {
    if (props.setClients) {
      props.setClients((prev: any[]) => {
        // Replace if same id already exists (defensive against duplicate calls)
        const filtered = prev.filter((c: any) => c.id !== newClient.id);
        return [...filtered, newClient];
      });
    }
    setCreateClientFor(null);
    handleClientSelectChange(String(newClient.id));
  }, [props, handleClientSelectChange]);

  React.useEffect(() => {
    if (pendingProductFocusIndex == null) return;
    const raf = window.requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>(`input[data-est-product-index="${pendingProductFocusIndex}"]`);
      input?.focus();
      input?.select();
      setPendingProductFocusIndex(null);
    });
    return () => window.cancelAnimationFrame(raf);
  }, [pendingProductFocusIndex, estItems.length]);

  React.useEffect(() => {
    if (pendingElementFocusIndex == null) return;
    const raf = window.requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>(`input[data-est-element-index="${pendingElementFocusIndex}"]`);
      input?.focus();
      input?.select();
      setPendingElementFocusIndex(null);
    });
    return () => window.cancelAnimationFrame(raf);
  }, [pendingElementFocusIndex, estItems.length]);

  const focusProductInput = (rowIndex: number) => {
    window.requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>(`input[data-est-product-index="${rowIndex}"]`);
      input?.focus();
      input?.select();
    });
  };

  const focusElementInput = (rowIndex: number) => {
    window.requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>(`input[data-est-element-index="${rowIndex}"]`);
      input?.focus();
      input?.select();
    });
  };

  const storeSearchText = (store: any) => [
    store.storeCode,
    store.name,
    store.city,
    store.state,
    store.regionZone,
    store.location,
    store.address,
  ].filter(Boolean).join(" ").toLowerCase();

  const applyBillingProfile = (bp: any) => {
    if (!bp) return;
    setEstBillingProfileId(String(bp.id));
    const bpText = [
      bp.legalCompanyName ? `M/S : ${bp.legalCompanyName}` : "",
      bp.billingAddress || "",
    ].filter(Boolean).join("\n");
    setEstBillingTo(bpText || bp.legalCompanyName);
    setEstGstin(bp.gstin);
    setEstStateCode(bp.stateCode);
    setEstPan(bp.pan || "");
    setGstProfileSearch(`${normalizeDisplayName(bp.state || bp.branchLocationName)} — ${normalizeDisplayName(bp.legalCompanyName)} (${normalizeGstinPan(bp.gstin)})`);
  };

  // Memoized derivations — computed once per estItems change, not per render.
  const activeStoreIds = React.useMemo<string[]>(() =>
    Array.from(new Set(estItems.map((it: any) => String(it.storeId || "")).filter(Boolean))),
    [estItems]
  );

  const storeBreakdownMemo = React.useMemo(() => {
    let grandMaterial = 0, grandSgst = 0, grandCgst = 0, grandIgst = 0;
    const breakdown = activeStoreIds.map((sid: string) => {
      const rows = estItems.filter((it: any) => String(it.storeId) === sid);
      const productRows = rows.filter((r: any) => r.lineType === "product" || !r.lineType);
      const packingRows = rows.filter((r: any) => r.lineType === "packing");
      const installRows = rows.filter((r: any) => r.lineType === "installation");
      const transportRows = rows.filter((r: any) => r.lineType === "transport");
      const materialBase = productRows.reduce((s: number, r: any) => s + (Number(r.amount) || 0), 0);
      const materialSgst = productRows.reduce((s: number, r: any) => s + (Number(r.sgstAmount) || 0), 0);
      const materialCgst = productRows.reduce((s: number, r: any) => s + (Number(r.cgstAmount) || 0), 0);
      const materialIgst = productRows.reduce((s: number, r: any) => s + (Number(r.igstAmount) || 0), 0);
      const packAmt = packingRows.reduce((s: number, r: any) => s + (Number(r.amount) || 0), 0);
      const implAmt = installRows.reduce((s: number, r: any) => s + (Number(r.amount) || 0), 0);
      const trans = transportRows.reduce((s: number, r: any) => s + (Number(r.amount) || 0), 0);
      const svcSgst = [...packingRows, ...installRows, ...transportRows].reduce((s: number, r: any) => s + (Number(r.sgstAmount) || 0), 0);
      const svcCgst = [...packingRows, ...installRows, ...transportRows].reduce((s: number, r: any) => s + (Number(r.cgstAmount) || 0), 0);
      const svcIgst = [...packingRows, ...installRows, ...transportRows].reduce((s: number, r: any) => s + (Number(r.igstAmount) || 0), 0);
      grandMaterial += materialBase + packAmt + implAmt + trans;
      grandSgst += materialSgst + svcSgst;
      grandCgst += materialCgst + svcCgst;
      grandIgst += materialIgst + svcIgst;
      return { sid, rows, productRows, packingRows, installRows, transportRows, materialBase, materialSgst, materialCgst, materialIgst, packAmt, implAmt, trans };
    });
    return { breakdown, grandMaterial, grandSgst, grandCgst, grandIgst, grandTotal: grandMaterial + grandSgst + grandCgst + grandIgst };
  }, [estItems, activeStoreIds]);

  return (
        <div className="space-y-6">
          {!showEstimateForm ? (
            <div className="space-y-6">
              <div className="flex justify-between items-center bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex-wrap gap-3">
                <div>
                  <h3 className="font-bold text-slate-800 text-lg">Sunrise Estimates Registry</h3>
                  <p className="text-xs text-slate-400">Create estimates, track approvals, upload POs, and generate Delivery Challans or WCC certificates.</p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex items-center gap-1 px-2 py-1 border border-slate-200 rounded bg-white">
                    <input value={estimateSearch} onChange={e => setEstimateSearch(e.target.value)} placeholder="Search estimate / client / PO" className="bg-transparent outline-none text-xs w-56" />
                  </div>
                  <select value={estimateStatusFilter} onChange={e => setEstimateStatusFilter(e.target.value)} className="px-2 py-1 border border-slate-200 rounded bg-white text-xs">
                    <option value="all">All statuses</option>
                    <option value="draft">Draft</option>
                    <option value="sent">Sent</option>
                    <option value="approved">Approved</option>
                    <option value="awaiting_po">Awaiting PO</option>
                    <option value="po_received">PO received</option>
                    <option value="rejected">Rejected</option>
                    <option value="archived">Archived</option>
                  </select>
                  <button
                    onClick={async () => {
                      try {
                        const r = await fetch(`/api/numbering/estimate/next`, { headers: { Authorization: `Bearer ${token}` } });
                        if (r.ok) {
                          const { number } = await r.json();
                          setEstNumber(number);
                        } else {
                          setEstNumber("");
                        }
                      } catch {
                        setEstNumber("");
                      }
                      setEstDate(new Date().toISOString().slice(0, 10));
                      setEditingEstimateId?.(null);
                      setShowEstimateForm(true);
                    }}
                    className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-orange-600 to-amber-500 hover:from-orange-500 hover:to-amber-400 text-white text-xs font-bold rounded-lg transition shadow-md"
                  >
                    <Plus className="w-4 h-4" />
                    New Estimate
                  </button>
                </div>
              </div>

              {/* Estimate List Table */}
              <div className="bg-orange-50/50 border border-orange-100 rounded-xl px-5 py-3 text-[11px] text-slate-600 font-semibold flex flex-wrap items-center gap-1.5">
                <span className="text-orange-700 font-black mr-1">Workflow:</span>
                {(["Create Estimate", "Export / Send", "Approve", "Upload PO", "Create DC / WCC", "Invoice & Payment"] as const).map((step, i, arr) => (
                  <React.Fragment key={step}>
                    <span className="bg-white border border-orange-200 rounded px-2 py-0.5 text-orange-800">{i + 1}. {step}</span>
                    {i < arr.length - 1 && <span className="text-orange-300">→</span>}
                  </React.Fragment>
                ))}
              </div>

              {/* Estimate List Table */}
              <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs text-slate-700">
                    <thead className="bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wider border-b border-slate-200 sticky top-0">
                      <tr>
                        <th className="px-3 py-2">Estimate No</th>
                        <th className="px-3 py-2">Title</th>
                        <th className="px-3 py-2">Client</th>
                        <th className="px-3 py-2">Brand</th>
                        <th className="px-3 py-2">PO No</th>
                        <th className="px-3 py-2">Date</th>
                        <th className="px-3 py-2">Format</th>
                        <th className="px-3 py-2">Linked Docs</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2 text-right">Amount</th>
                        <th className="px-3 py-2 text-center">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {estListPager.slice
                        .map((e) => {
                        const client = clients.find(c => c.id === e.clientId);
                        const brand = brands.find(b => b.id === e.brandId);
                        // Live filter — must exclude soft-deleted rows so the
                        // badge count updates instantly after a delete (without
                        // a manual reload). Pattern mirrors OperationsPage
                        // line 3207's projectChallans derivation.
                        const estChallans = challans.filter(c =>
                          c.estimateId === e.id
                          && (c as any).status !== "deleted"
                          && !(c as any).metadata?.deleted
                        );
                        const estInvoices = invoices.filter(i =>
                          i.estimateId === e.id
                          && (i as any).status !== "deleted"
                          && (i as any).status !== "cancelled"
                        );
                        const hasPo = Boolean(e.poNumber);
                        const hasDc = estChallans.length > 0;
                        const hasInv = estInvoices.length > 0;
                        const isAblbl = isAblblFormat(e.clientFormat);
                        return (
	                          <tr key={e.id} id={`est-${e.id}`} className="hover:bg-orange-50/30 transition">
	                            <td className="px-3 py-2 font-mono text-orange-600 font-bold">
                              {/* Estimate Number → opens Estimate Summary preview (not Project) */}
                              <button
                                type="button"
                                onClick={() => handleViewEstimateDetails(e, "estimate")}
                                title="Open Estimate Summary"
                                className="hover:underline"
                              >
                                {e.estimateNumber}
                              </button>
                            </td>
	                            <td className="px-3 py-2 font-semibold text-slate-900 max-w-[220px] truncate" title={e.title}>{e.title}</td>
	                            <td className="px-3 py-2 text-slate-700">
                              <Link href={`/clients/${e.clientId}`} className="hover:text-orange-600 hover:underline">{normalizeDisplayName(client?.name) || `ID: ${e.clientId}`}</Link>
                            </td>
	                            <td className="px-3 py-2 text-slate-600">{brand?.name || "—"}</td>
	                            <td className="px-3 py-2 font-mono text-purple-700">
                              {e.poNumber ? (
                                e.poFilePath ? (
                                  <a href={e.poFilePath} target="_blank" rel="noreferrer" className="hover:underline">{e.poNumber}</a>
                                ) : (
                                  <span>{e.poNumber}</span>
                                )
                              ) : <span className="text-slate-300">—</span>}
                            </td>
	                            <td className="px-3 py-2 text-slate-500 font-mono text-[10px]">
                              {(e.estimateDate || e.createdAt) ? new Date(e.estimateDate || e.createdAt).toLocaleDateString("en-GB") : "—"}
                            </td>
	                            <td className="px-3 py-2">
                              <span className={`px-1.5 py-0.5 rounded text-[9px] uppercase font-black tracking-wide border ${isAblbl ? "bg-purple-50 text-purple-700 border-purple-100" : "bg-blue-50 text-blue-700 border-blue-100"}`}>
                                {displayFormatLabel(e.clientFormat)}
                              </span>
                            </td>
	                            <td className="px-3 py-2">
                              <div className="flex gap-1 items-center">
                                {/* PO badge → upload PO if missing, else open PO view */}
                                <button
                                  type="button"
                                  onClick={() => hasPo ? openPoViewerForEstimate?.(e) : openPoForEstimate?.(e)}
                                  className={`px-1.5 py-0.5 rounded text-[9px] font-bold border transition ${hasPo ? "bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100" : "bg-slate-50 text-slate-400 border-slate-200 hover:bg-slate-100"}`}
                                  title={hasPo ? `Open PO: ${e.poNumber}` : "Upload PO"}
                                >PO</button>
                                {/* WCC/DC badge → opens Documents tab filtered to that type */}
                                <button
                                  type="button"
                                  onClick={() => openDocumentListForEstimate?.(e, isAblbl ? "wcc" : "dc")}
                                  className={`px-1.5 py-0.5 rounded text-[9px] font-bold border transition ${hasDc ? "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100" : "bg-slate-50 text-slate-400 border-slate-200 hover:bg-slate-100"}`}
                                  title={hasDc ? estChallans.map(c => c.dcNumber).join(", ") : `Open ${isAblbl ? "WCC" : "DC"} tab`}
                                >
                                  {isAblbl ? "WCC" : "DC"}
                                  {hasDc && <span className="ml-1">{estChallans.length}</span>}
                                </button>
                                {/* Invoice badge → opens Invoice tab in project */}
                                <button
                                  type="button"
                                  onClick={() => hasInv ? openInvoiceEditor?.(estInvoices[0]) : handleViewEstimateDetails(e, "invoice")}
                                  className={`px-1.5 py-0.5 rounded text-[9px] font-bold border transition ${hasInv ? "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100" : "bg-slate-50 text-slate-400 border-slate-200 hover:bg-slate-100"}`}
                                  title={hasInv ? estInvoices.map((i: any) => i.invoiceNumber).join(", ") : "Open invoice tab"}
                                >
                                  INV{hasInv && <span className="ml-1">{estInvoices.length}</span>}
                                </button>
                              </div>
                            </td>
	                            <td className="px-3 py-2">
                              <span className={`px-1.5 py-0.5 rounded text-[9px] uppercase font-black tracking-wide border ${
                                e.status === "approved" || e.status === "po_received"
                                  ? "bg-green-50 text-green-700 border-green-100"
                                  : e.status === "awaiting_po"
                                    ? "bg-amber-50 text-amber-700 border-amber-100"
                                    : "bg-slate-50 text-slate-600 border-slate-100"
                              }`}>
                                {e.status.replace("_", " ")}
                              </span>
                            </td>
	                            <td className="px-3 py-2 text-right text-slate-900 font-bold font-mono">{formatCurrency(e.totalAmount)}</td>
	                            <td className="px-3 py-2 text-center">
	                              <div className="inline-flex items-center gap-1 justify-center">
	                                <button
	                                  onClick={() => handleViewEstimateDetails(e, "estimate")}
	                                  title="View estimate (preview, print, export)"
	                                  className="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-200 bg-white text-slate-700 hover:bg-slate-900 hover:text-white transition"
	                                  aria-label="View estimate"
	                                >
	                                  <Eye className="w-3.5 h-3.5" />
	                                </button>
	                                <Link
	                                  href={`/projects?estimateId=${e.id}`}
	                                  title="Open full project dashboard"
	                                  className="inline-flex h-7 items-center gap-1 rounded border border-orange-200 bg-orange-50 px-2 text-[10px] font-bold text-orange-700 hover:bg-orange-100 transition"
	                                >
	                                  <FolderOpen className="w-3.5 h-3.5" />
	                                  Project
	                                </Link>
	                                <button
	                                  onClick={() => handleEditEstimate(e)}
	                                  title="Edit estimate"
	                                  className="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 transition"
	                                  aria-label="Edit estimate"
	                                >
	                                  <Edit3 className="w-3.5 h-3.5" />
	                                </button>
	                                <a
	                                  href={`/api/operations/estimates/${e.id}/export-excel`}
	                                  title="Download as Excel"
	                                  className="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-200 bg-white text-emerald-700 hover:bg-emerald-50 transition"
	                                  aria-label="Export Excel"
	                                >
	                                  <FileSpreadsheet className="w-3.5 h-3.5" />
	                                </a>
                                {e.poNumber ? (
	                                  <button
	                                    onClick={() => openPoViewerForEstimate?.(e)}
	                                    title={`View PO ${e.poNumber}`}
	                                    className="inline-flex h-7 w-7 items-center justify-center rounded border border-purple-200 bg-white text-purple-700 hover:bg-purple-50 transition"
	                                    aria-label="View PO"
	                                  >
	                                    <Eye className="w-3.5 h-3.5" />
	                                  </button>
                                ) : (
	                                  <button
	                                    onClick={() => openPoForEstimate?.(e)}
	                                    title="Upload PO for this estimate"
	                                    className="inline-flex h-7 w-7 items-center justify-center rounded border border-purple-200 bg-white text-purple-700 hover:bg-purple-50 transition"
	                                    aria-label="Upload PO"
	                                  >
	                                    <Plus className="w-3.5 h-3.5" />
	                                  </button>
                                )}
	                                <button
	                                  onClick={() => openNewDcForEstimate?.(e)}
	                                  title={isAblblFormat(e.clientFormat) ? "Create WCC" : "Create DC"}
	                                  className="inline-flex h-7 w-7 items-center justify-center rounded border border-amber-200 bg-white text-amber-700 hover:bg-amber-50 transition"
	                                  aria-label={isAblblFormat(e.clientFormat) ? "Create WCC" : "Create DC"}
	                                >
	                                  <Plus className="w-3.5 h-3.5" />
	                                </button>
	                                <button
	                                  onClick={() => handleDeleteEstimate(e)}
	                                  title="Delete estimate"
	                                  className="inline-flex h-7 w-7 items-center justify-center rounded border border-red-200 bg-white text-red-600 hover:bg-red-50 transition"
	                                  aria-label="Delete estimate"
	                                >
	                                  <Trash className="w-3.5 h-3.5" />
	                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {estimates.length === 0 && (
                        <tr>
                          <td colSpan={11} className="text-center py-16 text-slate-400">
                            <FileSpreadsheet className="w-10 h-10 mx-auto mb-3 opacity-20" />
                            <p className="text-sm font-semibold">No estimates yet</p>
                            <p className="text-xs mt-1">Click <strong className="text-orange-600">New Estimate</strong> above to create your first signage estimate.</p>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                  <Pager page={estListPager.page} pageSize={estListPager.pageSize} total={estListPager.total} onPageChange={estListPager.setPage} className="px-3" />
                </div>
              </div>
            </div>
          ) : (
            // EXCEL-LIKE ESTIMATE BUILDER SHEET FORM
            <form onSubmit={handleCreateEstimate} className="eb-spreadsheet-workspace">
              <div className="eb-sheet-titlebar">
                <div className="min-w-0">
                  <h3>{editingEstimateId ? "Edit Estimate" : "New Estimate"}</h3>
                  <span>{estNumber || "Draft"} {estSubject ? `- ${estSubject}` : ""}</span>
                </div>
                <button
                  type="button"
                  onClick={() => { setShowEstimateForm(false); setEditingEstimateId?.(null); }}
                >
                  Register
                </button>
              </div>

              {/* ============================================================
                  EXCEL-STYLE ESTIMATE BUILDER — dense, square borders, no
                  rounded SaaS cards. Flow:
                  Client → Brand → Add Store / Site → item rows →
                  next store → save / export. Single vs multi-store is
                  derived from how many stores the user adds.
                  ============================================================ */}
              <div id="step-preview" />
              {(() => {
                const eClient = clients.find(c => c.id === Number(estClientId));
                const eClientFormat = normalizeFormatMode(eClient?.format);
                const eIsAbfrl = isAblblFormat(eClientFormat);
                if (estFormat !== eClientFormat) setEstFormat(eClientFormat);
                const wantedTitle = estSubject || estNumber || "";
                if (estTitle !== wantedTitle) setEstTitle(wantedTitle);

                // activeStoreIds is memoized at component level — do not redeclare here
                const eClientIdNum = Number(estClientId) || null;
                const eBrandIdNum = Number(estBrandId) || null;

                // Brand is controlled by Client. Only brands whose parent
                // client matches the selected client are eligible.
                const linkedBrands = brands.filter(b =>
                  b.isActive
                  && eClientIdNum != null
                  && b.parentClientId === eClientIdNum
                );
                // When editing an existing estimate the currently-selected
                // brand must remain visible even if its parent_client_id is
                // missing or no longer matches, otherwise the select shows
                // empty for legacy rows.
                const brandsForDropdown = eBrandIdNum && !linkedBrands.some(b => b.id === eBrandIdNum)
                  ? [...linkedBrands, ...brands.filter(b => b.id === eBrandIdNum)]
                  : linkedBrands;

                // Store list visibility rules:
                //   ABLBL  → require Client AND Brand before showing any stores.
                //   Normal → require Client; Brand filters further when set.
                const canShowStoreList = eIsAbfrl
                  ? Boolean(eClientIdNum && eBrandIdNum)
                  : Boolean(eClientIdNum);
                const eligibleStores = !canShowStoreList ? [] : stores.filter(s =>
                  s.isActive
                  && s.clientId === eClientIdNum
                  && (!eBrandIdNum || s.brandId === eBrandIdNum)
                );

                const handleBrandSelectChange = (brandIdVal: string) => {
                  setEstBrandId(brandIdVal);
                  // Brand controls Store. Drop any previously-added stores so
                  // rows from the old brand can't bleed into the new one.
                  setEstItems([]);
                  setEstStoreOverrides({});
                  setPendingStoreIds([]);
                  setStoreSearch("");
                };
                const sortedBillingProfiles = [...clientBillingProfilesList].sort((a, b) => {
                  const aKey = normalizeDisplayName(a.state || a.branchLocationName || a.legalCompanyName || "");
                  const bKey = normalizeDisplayName(b.state || b.branchLocationName || b.legalCompanyName || "");
                  return aKey.localeCompare(bKey);
                });
                const filteredBillingProfiles = sortedBillingProfiles.filter(bp => {
                  const q = gstProfileSearch.trim().toLowerCase();
                  if (!q) return true;
                  return [
                    bp.state,
                    bp.branchLocationName,
                    bp.legalCompanyName,
                    bp.gstin,
                  ].filter(Boolean).join(" ").toLowerCase().includes(q);
                });
                const visibleBillingProfiles = filteredBillingProfiles.slice(0, 8);
                const focusStoreSearch = () => {
                  window.requestAnimationFrame(() => {
                    const input = document.querySelector<HTMLInputElement>("[data-est-store-search]");
                    input?.focus();
                    input?.select();
                  });
                };
                const openStorePickerAndFocusSearch = () => {
                  setStorePickerOpen(true);
                  setStoreHighlightIndex(0);
                  focusStoreSearch();
                };
                const selectHighlightedGstProfile = () => {
                  const profile = visibleBillingProfiles[gstProfileHighlightIndex] || visibleBillingProfiles[0];
                  if (!profile) return false;
                  applyBillingProfile(profile);
                  setGstProfileOpen(false);
                  return true;
                };
                const handleGstProfileKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
                  if (event.key === "Escape") {
                    setGstProfileOpen(false);
                    return;
                  }
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    setGstProfileOpen(true);
                    if (visibleBillingProfiles.length === 0) return;
                    setGstProfileHighlightIndex(prev => {
                      const delta = event.key === "ArrowDown" ? 1 : -1;
                      return (prev + delta + visibleBillingProfiles.length) % visibleBillingProfiles.length;
                    });
                    return;
                  }
                  if (event.key === "Enter") {
                    event.preventDefault();
                    selectHighlightedGstProfile();
                    return;
                  }
                  if (event.key === "Tab" && !event.shiftKey) {
                    event.preventDefault();
                    if (visibleBillingProfiles.length > 0) {
                      selectHighlightedGstProfile();
                    } else {
                      setGstProfileOpen(false);
                    }
                    openStorePickerAndFocusSearch();
                  }
                };
                const handleGstStepKeyDown = (event: React.KeyboardEvent<HTMLSelectElement>) => {
                  if (event.key !== "Tab" || event.shiftKey || clientBillingProfilesList.length > 0) return;
                  event.preventDefault();
                  openStorePickerAndFocusSearch();
                };
                const availableStores = eligibleStores.filter(s => !activeStoreIds.includes(String(s.id)));
                const filteredStores = availableStores
                  .filter(s => {
                    const q = storeSearch.trim().toLowerCase();
                    if (!q) return true;
                    return storeSearchText(s).includes(q);
                  })
                  .sort((a, b) => storeDisplay(a).localeCompare(storeDisplay(b)));
                const visibleStores = filteredStores.slice(0, 80);

                const addStores = (storeIds: string[]) => {
                  const nextIds = Array.from(new Set(storeIds))
                    .filter(sid => sid && !activeStoreIds.includes(sid));
                  if (nextIds.length === 0) return;
                  setEstItems((prev: any[]) => [
                    ...prev,
                    ...nextIds.map((sid, i) => blankRowForStore(sid, prev.length + i + 1, estGstType)),
                  ]);
                  setPendingStoreIds([]);
                  setStorePickerOpen(false);
                  setStoreSearch("");
                };
                const addStoreAndFocusProduct = (storeIdStr: string) => {
                  if (!storeIdStr || activeStoreIds.includes(storeIdStr)) return false;
                  setEstItems((prev: any[]) => {
                    const newIndex = prev.length;
                    setPendingProductFocusIndex(newIndex);
                    return [
                      ...prev,
                      blankRowForStore(storeIdStr, newIndex + 1, estGstType),
                    ];
                  });
                  setPendingStoreIds([]);
                  setStorePickerOpen(false);
                  setStoreSearch("");
                  return true;
                };
                const selectHighlightedStore = () => {
                  const store = visibleStores[storeHighlightIndex] || visibleStores[0];
                  if (!store) return false;
                  return addStoreAndFocusProduct(String(store.id));
                };
                const handleStoreSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
                  if (event.key === "Escape") {
                    setStorePickerOpen(false);
                    return;
                  }
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    if (visibleStores.length === 0) return;
                    setStoreHighlightIndex(prev => {
                      const delta = event.key === "ArrowDown" ? 1 : -1;
                      return (prev + delta + visibleStores.length) % visibleStores.length;
                    });
                    return;
                  }
                  // Space = toggle highlighted store without closing picker (for multi-select)
                  if (event.key === " ") {
                    event.preventDefault();
                    const store = visibleStores[storeHighlightIndex] || visibleStores[0];
                    if (!store) return;
                    const sid = String(store.id);
                    if (activeStoreIds.includes(sid)) return;
                    setPendingStoreIds(prev =>
                      prev.includes(sid) ? prev.filter(id => id !== sid) : [...prev, sid]
                    );
                    return;
                  }
                  // Enter = add single highlighted store immediately and go to grid
                  if (event.key === "Enter") {
                    event.preventDefault();
                    if (pendingStoreIds.length > 0) {
                      addStores(pendingStoreIds);
                    } else {
                      selectHighlightedStore();
                    }
                    return;
                  }
                  // Tab = confirm pending stores (or highlighted single) and close
                  if (event.key === "Tab" && !event.shiftKey && visibleStores.length > 0) {
                    event.preventDefault();
                    if (pendingStoreIds.length > 0) {
                      addStores(pendingStoreIds);
                    } else {
                      selectHighlightedStore();
                    }
                  }
                };
                const removeStore = (sid: string) => {
                  if (!confirm("Remove this store and all its rows from the estimate?")) return;
                  setEstItems((prev: any[]) => prev
                    .filter((it: any) => String(it.storeId) !== sid)
                    .map((it: any, i: number) => ({ ...it, sl: i + 1 })));
                };
                const addRowToStore = (sid: string) => {
                  setEstItems((prev: any[]) => [
                    ...prev,
                    blankRowForStore(sid, prev.length + 1, estGstType),
                  ]);
                };
                const moveStore = (sid: string, direction: "up" | "down") => {
                  const currentIndex = activeStoreIds.indexOf(sid);
                  const swapIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
                  const swapSid = activeStoreIds[swapIndex];
                  if (currentIndex < 0 || !swapSid) return;
                  // Build explicit ordinal map for all stores, then swap the two
                  const orderMap: Record<string, number> = {};
                  activeStoreIds.forEach((storeSid, idx) => { orderMap[storeSid] = idx * 1000; });
                  orderMap[sid] = swapIndex * 1000;
                  orderMap[swapSid] = currentIndex * 1000;
                  applyGridMutation(rows =>
                    rows.map(row => ({
                      ...row,
                      storeSortOrder: orderMap[String(row.storeId || "")] ?? 0,
                    })).sort((a, b) => {
                      const storeDelta = (Number(a.storeSortOrder) || 0) - (Number(b.storeSortOrder) || 0);
                      return storeDelta || ((Number(a.rowSortOrder) || 0) - (Number(b.rowSortOrder) || 0));
                    })
                  );
                };
                const duplicateStore = (sid: string) => {
                  const sourceRows = estItems.filter((row: any) => String(row.storeId || "") === sid);
                  if (sourceRows.length === 0) return;
                  const existingOverride = estStoreOverrides[sid] || {};
                  const sourceStore = stores.find((s: any) => String(s.id) === sid);
                  const defaultName = `${existingOverride.storeName || sourceStore?.name || `Store ${sid}`} Copy`;
                  const newSid = sid.startsWith("manual-") ? `manual-${Date.now()}` : `copy-${sid}-${Date.now()}`;
                  setEstStoreOverrides((prev: Record<string, any>) => ({
                    ...prev,
                    [newSid]: {
                      ...existingOverride,
                      storeName: defaultName,
                      storeCity: existingOverride.storeCity || sourceStore?.city || "",
                      storeState: existingOverride.storeState || sourceStore?.state || "",
                      storeAddress: existingOverride.storeAddress || sourceStore?.address || "",
                    },
                  }));
                  applyGridMutation(rows => [
                    ...rows,
                    ...sourceRows.map((row: any) => ({
                      ...row,
                      storeId: newSid,
                      storeCode: null,
                      storeSortOrder: undefined,
                      rowSortOrder: undefined,
                    })),
                  ]);
                  // Open inline rename immediately after duplication
                  setRenamingStoreId(newSid);
                  setRenamingStoreName(defaultName);
                };
                const addRowToStoreFromKeyboard = (event: React.KeyboardEvent<HTMLInputElement>, sid: string) => {
                  if (event.key !== "Tab" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
                  event.preventDefault();
                  setEstItems((prev: any[]) => {
                    const newIndex = prev.length;
                    const next = [
                      ...prev,
                      blankRowForStore(sid, newIndex + 1, estGstType),
                    ];
                    setPendingProductFocusIndex(newIndex);
                    return next;
                  });
                };
                const moveFromRateToNextElement = (
                  event: React.KeyboardEvent<HTMLInputElement>,
                  sid: string,
                  nextRowIndex: number | null,
                ) => {
                  if (event.key !== "Tab" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
                  event.preventDefault();
                  if (nextRowIndex != null) {
                    focusElementInput(nextRowIndex);
                    return;
                  }
                  setEstItems((prev: any[]) => {
                    const newIndex = prev.length;
                    const next = [
                      ...prev,
                      blankRowForStore(sid, newIndex + 1, estGstType),
                    ];
                    setPendingElementFocusIndex(newIndex);
                    return next;
                  });
                };
                const setStoreOverride = (sid: string, patch: Partial<{
                  packingPercent: string;
                  implementationPercent: string;
                  transportType: "local" | "outstation";
                  transportAmount: string;
                  transportKm: string;
                  transportRate: string;
                  transportDescription: string;
                  storeName: string;
                  storeLocation: string;
                  storeCity: string;
                  storeState: string;
                  storeAddress: string;
                }>) => {
                  setEstStoreOverrides((prev: Record<string, any>) => ({
                    ...prev,
                    [sid]: { ...(prev[sid] || {}), ...patch },
                  }));
                };
                const addManualStore = () => {
                  const name = manualStoreName.trim();
                  if (!name) return;
                  const sid = `manual-${Date.now()}`;
                  setEstStoreOverrides((prev: Record<string, any>) => ({
                    ...prev,
                    [sid]: {
                      ...(prev[sid] || {}),
                      storeName: name,
                      storeLocation: manualStoreLocation.trim(),
                      storeAddress: manualStoreLocation.trim(),
                    },
                  }));
                  setEstItems((prev: any[]) => [
                    ...prev,
                    blankRowForStore(sid, prev.length + 1, estGstType),
                  ]);
                  setManualStoreName("");
                  setManualStoreLocation("");
                };
                const storeEntryBlocked = (eIsAbfrl && (!eClientIdNum || !eBrandIdNum)) || (!eIsAbfrl && !eClientIdNum);
                const sellerContact = [sellerProfile?.mobile, sellerProfile?.email].filter(Boolean).join(" | ");
                const missingSellerFields = [
                  !sellerProfile?.name ? "Company Name" : "",
                  !sellerProfile?.gstin ? "GST Number" : "",
                  !sellerProfile?.address ? "Address" : "",
                  !sellerProfile?.stateCode ? "State Code" : "",
                  !sellerContact ? "Contact Information" : "",
                ].filter(Boolean);
                const compactHeaderBits = [
                  estNumber || "Draft",
                  estSubject || estTitle || "Untitled Estimate",
                  normalizeDisplayName(eClient?.name) || "No Client",
                  estGstin || estStateCode ? "GST Loaded" : "GST Missing",
                ];

                // storeBreakdown and grand totals are memoized at component level
                const storeBreakdown = storeBreakdownMemo.breakdown;
                const { grandMaterial, grandSgst, grandCgst, grandIgst, grandTotal } = storeBreakdownMemo;
                const showStandardColumn = eIsAbfrl;
                const showMaterialCodeColumn = eIsAbfrl && estAbfrlProjectType === "CAPEX";
                const gridColumns = buildEstimateColumns(showMaterialCodeColumn, showStandardColumn, columnPrefs);
                const tableCols = gridColumns.length;
                const navigableColumnIds = gridColumns
                  .filter(col => col.id !== "select")
                  .map(col => col.id);
                const frozenLeftById = gridColumns.reduce((acc, column) => {
                  if (column.fixed) {
                    acc.map.set(column.id, acc.left);
                    acc.left += column.width;
                  }
                  return acc;
                }, { left: 0, map: new Map<EstimateGridColumnId, number>() }).map;
                const persistGridColumns = (nextColumns: EstimateGridColumn[]) => {
                  persistColumnPrefs({
                    order: nextColumns.map(col => col.id),
                    widths: nextColumns.reduce<Partial<Record<EstimateGridColumnId, number>>>((acc, col) => {
                      acc[col.id] = col.width;
                      return acc;
                    }, {}),
                  });
                };
                const resizeColumn = (columnId: EstimateGridColumnId, width: number) => {
                  const next = gridColumns.map(col =>
                    col.id === columnId ? { ...col, width: Math.max(col.minWidth, width) } : col
                  );
                  persistGridColumns(next);
                };
                const moveColumn = (fromId: EstimateGridColumnId, toId: EstimateGridColumnId) => {
                  if (!fromId || fromId === toId) return;
                  const fromColumn = gridColumns.find(col => col.id === fromId);
                  const toColumn = gridColumns.find(col => col.id === toId);
                  if (!fromColumn || !toColumn || fromColumn.fixed || toColumn.fixed) return;
                  const without = gridColumns.filter(col => col.id !== fromId);
                  const toIndex = without.findIndex(col => col.id === toId);
                  const next = [...without.slice(0, toIndex), fromColumn, ...without.slice(toIndex)];
                  persistGridColumns(next);
                };
                const rowStoreInfo = (row: any) => {
                  const sid = String(row.storeId || "");
                  const store = stores.find((s: any) => String(s.id) === sid);
                  const override = estStoreOverrides[sid] || {};
                  return {
                    sid,
                    name: store?.name || override.storeName || "",
                    code: store?.storeCode || row.storeCode || "",
                    city: store?.city || override.storeCity || override.storeLocation || "",
                  };
                };
                const rowProductText = (row: any) => {
                  const product = productOptions.find(({ product }) => String(product.id) === String(row.productId || ""))?.product;
                  return [product?.name, row.description, row.materialDescription].filter(Boolean).join(" ");
                };
                const normalizedFilter = (value: string) => value.trim().toLowerCase();
                const elementFilter = normalizedFilter(rowFilterElement);
                const productFilter = normalizedFilter(rowFilterProduct);
                const storeFilter = normalizedFilter(rowFilterStore);
                const cityFilter = normalizedFilter(rowFilterCity);
                const rowMatchesFilters = (row: any) => {
                  const info = rowStoreInfo(row);
                  if (elementFilter && !String(row.itemName || "").toLowerCase().includes(elementFilter)) return false;
                  if (productFilter && !rowProductText(row).toLowerCase().includes(productFilter)) return false;
                  if (storeFilter && ![info.name, info.code, info.sid].join(" ").toLowerCase().includes(storeFilter)) return false;
                  if (cityFilter && !String(info.city || "").toLowerCase().includes(cityFilter)) return false;
                  return true;
                };
                const productRowsAll = estItems.filter((row: any) => row.lineType === "product" || !row.lineType);
                const visibleProductRowsAll = productRowsAll.filter(rowMatchesFilters);
                const visibleGridRows = estItems.filter((row: any) => {
                  if (row.lineType === "product" || !row.lineType) return rowMatchesFilters(row);
                  return true;
                });
                const filteredSummary = visibleProductRowsAll.reduce((acc, row: any) => {
                  // Mirror the engine's auto-detect: sqft is real area only when
                  // W × H × Q produces a positive value; otherwise the row is
                  // piece-based and contributes 0 to total sqft.
                  const w = Number(row.width) || 0;
                  const h = Number(row.height) || 0;
                  const q = Number(row.quantity) || 0;
                  const sqft = row.calculationType === "running_inch"
                    ? w * h * q
                    : (w * h * q) / 144;
                  acc.qty += q;
                  acc.sqft += sqft;
                  acc.materialValue += Number(row.amount) || 0;
                  return acc;
                }, { qty: 0, sqft: 0, materialValue: 0 });
                const elementMetrics = Array.from(productRowsAll.reduce<Map<string, number>>((acc, row: any) => {
                  const element = String(row.itemName || "Blank").trim() || "Blank";
                  acc.set(element, (acc.get(element) || 0) + (Number(row.quantity) || 0));
                  return acc;
                }, new Map<string, number>()).entries()).sort((a, b) => b[1] - a[1]).slice(0, 8);
                const clearRowFilters = () => {
                  setRowFilterElement("");
                  setRowFilterProduct("");
                  setRowFilterStore("");
                  setRowFilterCity("");
                };
                const findMatchesRow = (row: any) => {
                  const q = findText.trim().toLowerCase();
                  if (!q) return false;
                  const info = rowStoreInfo(row);
                  return [
                    row.itemName,
                    row.description,
                    row.hsn,
                    row.materialCode,
                    info.name,
                    info.code,
                    info.city,
                  ].filter(Boolean).join(" ").toLowerCase().includes(q);
                };
                const focusFirstFindMatch = () => {
                  const matchIndex = estItems.findIndex(findMatchesRow);
                  if (matchIndex >= 0) {
                    selectSingleRow(matchIndex);
                    focusCell(matchIndex, "element", false);
                  }
                };
                const replaceInSelectedRows = () => {
                  if (!findText) return;
                  const indexes = selectedRowIndexes.length > 0 ? selectedRowIndexes : estItems.map((_: any, index: number) => index);
                  const needle = findText;
                  applyGridMutation(rows => rows.map((row, index) => {
                    if (!indexes.includes(index)) return row;
                    return {
                      ...row,
                      itemName: String(row.itemName || "").split(needle).join(replaceText),
                      description: String(row.description || "").split(needle).join(replaceText),
                    };
                  }));
                };
                const handleWorkspaceKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
                  const target = event.target as HTMLElement;
                  const inEditableText = target.closest("input, textarea, select");
                  const key = event.key.toLowerCase();
                  // Ctrl+Shift+S: open store picker (checked before Ctrl+S)
                  if ((event.ctrlKey || event.metaKey) && event.shiftKey && key === "s") {
                    event.preventDefault();
                    openStorePickerAndFocusSearch();
                    return;
                  }
                  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && key === "s") {
                    event.preventDefault();
                    handleCreateEstimate({ preventDefault: () => {} } as React.FormEvent);
                    return;
                  }
                  // When focus is inside an editable input/textarea, let browser handle C/V/X/A
                  if (inEditableText && (event.ctrlKey || event.metaKey) && ["c","v","x","a"].includes(key)) return;
                  if ((event.ctrlKey || event.metaKey) && key === "a") {
                    event.preventDefault();
                    setSelectedRowIndexes(estItems.map((_: any, i: number) => i));
                    return;
                  }
                  if ((event.ctrlKey || event.metaKey) && key === "c") {
                    event.preventDefault();
                    copySelectedRows();
                    return;
                  }
                  if ((event.ctrlKey || event.metaKey) && key === "v") {
                    event.preventDefault();
                    // Row paste only when Ctrl+V originated on the workspace div itself
                    // (not bubbled up from a cell input/button). When focus is on any
                    // cell element, handleCellKeyDown already ran and handled the paste —
                    // letting the event continue here would double-paste rows.
                    if (event.target !== event.currentTarget) return;
                    pasteAfterSelection();
                    return;
                  }
                  if ((event.ctrlKey || event.metaKey) && key === "d") {
                    event.preventDefault();
                    duplicateSelectedRows();
                    return;
                  }
                  if ((event.ctrlKey || event.metaKey) && key === "z") {
                    event.preventDefault();
                    undoGridChange();
                    return;
                  }
                  if ((event.ctrlKey || event.metaKey) && key === "y") {
                    event.preventDefault();
                    redoGridChange();
                    return;
                  }
                  if ((event.ctrlKey || event.metaKey) && key === "f") {
                    event.preventDefault();
                    document.querySelector<HTMLInputElement>("[data-est-find-input]")?.focus();
                    return;
                  }
                  if ((event.ctrlKey || event.metaKey) && event.key === "Delete") {
                    event.preventDefault();
                    deleteSelectedRowsAction();
                    return;
                  }
                  if (event.altKey && event.key === "Enter" && !inEditableText) {
                    event.preventDefault();
                    addRowBelowSelection();
                    return;
                  }
                  if ((event.key === "Delete" || event.key === "Backspace") && selectedRowIndexes.length > 0 && !inEditableText) {
                    event.preventDefault();
                    deleteSelectedRowsAction();
                  }
                };
                const navigateCell = (
                  rowIndex: number,
                  columnId: EstimateGridColumnId,
                  direction: "left" | "right" | "up" | "down",
                  edit = false,
                ) => {
                  const visibleRowIndexes = visibleGridRows.map((row: any) => estItems.indexOf(row)).filter((idx: number) => idx >= 0);
                  const rowPosition = visibleRowIndexes.indexOf(rowIndex);
                  const colPosition = navigableColumnIds.indexOf(columnId);
                  if (rowPosition < 0 || colPosition < 0) return;
                  let nextRowPosition = rowPosition;
                  let nextColPosition = colPosition;
                  if (direction === "left") {
                    if (edit) {
                      // Tab/Shift+Enter: jump only between editable columns, skip calculated ones
                      const editPos = editableColumnIds.indexOf(columnId as any);
                      if (editPos > 0) {
                        const prevEditableId = editableColumnIds[editPos - 1];
                        const prevNavPos = navigableColumnIds.indexOf(prevEditableId as any);
                        if (prevNavPos >= 0) nextColPosition = prevNavPos;
                      }
                      // At first editable col: stay put (don't jump back into calculated cols)
                    } else {
                      nextColPosition = Math.max(0, colPosition - 1);
                    }
                  }
                  if (direction === "right") {
                    if (edit) {
                      // Tab/Enter: jump only between editable columns, skip calculated ones
                      const editPos = editableColumnIds.indexOf(columnId as any);
                      const firstEditableNavPos = navigableColumnIds.findIndex(id => editableColumnIds.includes(id));
                      if (editPos >= 0 && editPos < editableColumnIds.length - 1) {
                        // Move to next editable column
                        const nextEditableId = editableColumnIds[editPos + 1];
                        const nextNavPos = navigableColumnIds.indexOf(nextEditableId as any);
                        if (nextNavPos >= 0) nextColPosition = nextNavPos;
                      } else {
                        // At last editable col (rate) or not in editable list: wrap to next row / new row
                        if (rowPosition < visibleRowIndexes.length - 1) {
                          nextRowPosition = rowPosition + 1;
                          nextColPosition = firstEditableNavPos >= 0 ? firstEditableNavPos : 0;
                        } else {
                          const currentItem = estItems[rowIndex];
                          const sid = String(currentItem?.storeId || "");
                          if (sid) {
                            setEstItems((prev: any[]) => {
                              const newIdx = prev.length;
                              window.requestAnimationFrame(() => focusCell(newIdx, "element", edit));
                              return [...prev, blankRowForStore(sid, newIdx + 1, estGstType)];
                            });
                          }
                          return;
                        }
                      }
                    } else {
                      // Arrow keys: navigate all navigable columns
                      nextColPosition = Math.min(navigableColumnIds.length - 1, colPosition + 1);
                    }
                  }
                  if (direction === "up") nextRowPosition = Math.max(0, rowPosition - 1);
                  if (direction === "down") nextRowPosition = Math.min(visibleRowIndexes.length - 1, rowPosition + 1);
                  focusCell(visibleRowIndexes[nextRowPosition], navigableColumnIds[nextColPosition], edit);
                };
                const handleCellKeyDown = (
                  event: React.KeyboardEvent<HTMLElement>,
                  rowIndex: number,
                  columnId: EstimateGridColumnId,
                  commit?: () => void,
                ) => {
                  const editing = isEditingCell(rowIndex, columnId);

                  // Ctrl+Shift+S: open store picker (must be checked before Ctrl+S)
                  if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "s") {
                    event.preventDefault();
                    if (editing) { commit?.(); stopEditCell(); }
                    openStorePickerAndFocusSearch();
                    return;
                  }
                  // Ctrl+S: save (always intercept — works while editing or not)
                  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "s") {
                    event.preventDefault();
                    if (editing) { commit?.(); stopEditCell(); }
                    handleCreateEstimate({ preventDefault: () => {} } as React.FormEvent);
                    return;
                  }

                  // While editing a cell, let the browser handle clipboard (C/V/X/A)
                  // and do NOT intercept row-level shortcuts.
                  if (editing && (event.ctrlKey || event.metaKey)) {
                    const k = event.key.toLowerCase();
                    if (k === "c" || k === "v" || k === "x" || k === "a") return;
                  }

                  // Row-level Ctrl shortcuts (only active when NOT in cell edit mode)
                  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") {
                    event.preventDefault();
                    copySelectedRows();
                    return;
                  }
                  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") {
                    event.preventDefault();
                    // Cell paste: read clipboard and inject into this cell (not editing).
                    // Only for text/numeric input columns; product/standard fall through to row paste.
                    const cellPasteCols: EstimateGridColumnId[] = ["element", "hsn", "width", "height", "quantity", "rate"];
                    if (cellPasteCols.includes(columnId)) {
                      void navigator.clipboard?.readText?.().then(text => {
                        const trimmed = (text ?? "").trim();
                        if (!trimmed) return;
                        setCellDrafts(prev => ({ ...prev, [getCellKey(rowIndex, columnId)]: trimmed }));
                        setEditingCell({ rowIndex, columnId });
                        window.requestAnimationFrame(() => {
                          const el = document.querySelector<HTMLInputElement>(`[data-cell-key="${getCellKey(rowIndex, columnId)}"]`);
                          if (el) { el.focus(); el.setSelectionRange?.(el.value.length, el.value.length); }
                        });
                      }).catch(() => {});
                      return;
                    }
                    pasteAfterSelection();
                    return;
                  }
                  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
                    // Not editing: select all rows
                    event.preventDefault();
                    setSelectedRowIndexes(estItems.map((_: any, i: number) => i));
                    return;
                  }
                  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") {
                    event.preventDefault();
                    duplicateSelectedRows();
                    return;
                  }
                  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
                    event.preventDefault();
                    undoGridChange();
                    return;
                  }
                  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
                    event.preventDefault();
                    redoGridChange();
                    return;
                  }
                  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
                    event.preventDefault();
                    document.querySelector<HTMLInputElement>("[data-est-find-input]")?.focus();
                    return;
                  }
                  if (event.altKey && event.key === "Enter") {
                    event.preventDefault();
                    if (editing) { commit?.(); stopEditCell(); }
                    addRowBelowSelection();
                    return;
                  }
                  if (event.altKey || event.ctrlKey || event.metaKey) return;

                  // F2: enter edit mode (Excel standard)
                  if (event.key === "F2") {
                    event.preventDefault();
                    if (!editing) beginEditCell(rowIndex, columnId);
                    return;
                  }
                  if (!editing && (event.key === "Delete" || event.key === "Backspace")) {
                    event.preventDefault();
                    deleteSelectedRowsAction();
                    return;
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    cancelEditCell(rowIndex, columnId);
                    return;
                  }
                  // Enter = next cell (right); Shift+Enter = previous cell (left)
                  if (event.key === "Enter") {
                    event.preventDefault();
                    if (editing) {
                      commit?.();
                      stopEditCell();
                    }
                    if (event.shiftKey) {
                      navigateCell(rowIndex, columnId, "left", true);
                    } else {
                      navigateCell(rowIndex, columnId, "right", true);
                    }
                    return;
                  }
                  // Tab: right (or left with Shift); immediately enters edit mode
                  if (event.key === "Tab") {
                    event.preventDefault();
                    if (editing) {
                      commit?.();
                      stopEditCell();
                    }
                    navigateCell(rowIndex, columnId, event.shiftKey ? "left" : "right", true);
                    return;
                  }
                  // Arrow keys: browse without entering edit mode
                  if (!editing && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
                    event.preventDefault();
                    const direction = event.key === "ArrowLeft"
                      ? "left"
                      : event.key === "ArrowRight"
                        ? "right"
                        : event.key === "ArrowUp"
                          ? "up"
                          : "down";
                    navigateCell(rowIndex, columnId, direction, false);
                    return;
                  }
                  // Printable character while cell is active (not editing): begin edit
                  // with the typed char as the initial value — no swallowing.
                  if (!editing && event.key.length === 1) {
                    beginEditCell(rowIndex, columnId, event.key);
                  }
                };
                const cellClassName = (rowIndex: number, column: EstimateGridColumn, align: "left" | "right" = "left") => [
                  align === "right" ? "num" : "",
                  column.fixed ? "eb-freeze-cell" : "",
                  isActiveCell(rowIndex, column.id) ? "eb-cell-active" : "",
                  isEditingCell(rowIndex, column.id) ? "eb-cell-editing" : "",
                ].filter(Boolean).join(" ");
                const cellStyle = (column: EstimateGridColumn, extra: React.CSSProperties = {}): React.CSSProperties => ({
                  width: column.width,
                  minWidth: column.minWidth,
                  ...(column.fixed ? { left: frozenLeftById.get(column.id) || 0 } : {}),
                  ...extra,
                });
                const getDraft = (rowIndex: number, columnId: EstimateGridColumnId, fallback: any) => {
                  const key = getCellKey(rowIndex, columnId);
                  return cellDrafts[key] ?? String(fallback ?? "");
                };
                const setDraft = (rowIndex: number, columnId: EstimateGridColumnId, value: string) => {
                  setCellDrafts(prev => ({ ...prev, [getCellKey(rowIndex, columnId)]: value }));
                };
                const commitDraft = (rowIndex: number, columnId: EstimateGridColumnId, field: string) => {
                  const key = getCellKey(rowIndex, columnId);
                  if (cellDrafts[key] !== undefined) {
                    handleEstimateItemChange(rowIndex, field, cellDrafts[key]);
                  }
                  setCellDrafts(prev => {
                    const next = { ...prev };
                    delete next[key];
                    return next;
                  });
                };
                const renderTextInput = (
                  item: any,
                  rowIndex: number,
                  column: EstimateGridColumn,
                  field: string,
                  fallback: string,
                  opts: { align?: "left" | "right"; inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"]; fontWeight?: number; placeholder?: string } = {},
                ) => {
                  const editing = isEditingCell(rowIndex, column.id);
                  const value = editing ? getDraft(rowIndex, column.id, fallback) : String(fallback ?? "");
                  const commit = () => commitDraft(rowIndex, column.id, field);
                  return (
                    <td key={column.id} className={cellClassName(rowIndex, column, opts.align)} style={cellStyle(column)}>
                      <input
                        type="text"
                        inputMode={opts.inputMode}
                        data-cell-key={getCellKey(rowIndex, column.id)}
                        readOnly={!editing}
                        value={value}
                        placeholder={opts.placeholder}
                        onFocus={() => {
                          selectSingleRow(rowIndex);
                          setActiveCell({ rowIndex, columnId: column.id });
                          if (editing) setDraft(rowIndex, column.id, value);
                        }}
                        onDoubleClick={() => beginEditCell(rowIndex, column.id)}
                        onChange={(event) => editing && setDraft(rowIndex, column.id, event.target.value)}
                        onBlur={() => {
                          if (editing) {
                            commit();
                            stopEditCell();
                          }
                        }}
                        onKeyDown={(event) => handleCellKeyDown(event, rowIndex, column.id, commit)}
                        style={{ fontWeight: opts.fontWeight, textAlign: opts.align === "right" ? "right" : "left" }}
                      />
                    </td>
                  );
                };
                const renderReadOnlyCell = (
                  rowIndex: number,
                  column: EstimateGridColumn,
                  value: React.ReactNode,
                  align: "left" | "right" = "left",
                  extra: React.CSSProperties = {},
                ) => (
                  <td key={column.id} className={cellClassName(rowIndex, column, align)} style={cellStyle(column, extra)}>
                    <button
                      type="button"
                      data-cell-key={getCellKey(rowIndex, column.id)}
                      className="eb-cell-readonly"
                      onFocus={() => {
                        selectSingleRow(rowIndex);
                        setActiveCell({ rowIndex, columnId: column.id });
                      }}
                      onDoubleClick={() => beginEditCell(rowIndex, column.id)}
                      onKeyDown={(event) => handleCellKeyDown(event, rowIndex, column.id)}
                    >
                      {value}
                    </button>
                  </td>
                );
                const renderRowActions = (rowIndex: number, column: EstimateGridColumn, selected: boolean, item: any) => {
                  if (column.id === "select") {
                    return (
                      <td key={column.id} className={`num eb-select-cell ${column.fixed ? "eb-freeze-cell" : ""}`} style={cellStyle(column)}>
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleRowSelection(rowIndex)}
                          onClick={(event) => event.stopPropagation()}
                          aria-label={`Select row ${item.sl}`}
                        />
                      </td>
                    );
                  }
                  return null;
                };
                const renderEstimateCell = (item: any, rowIndex: number, column: EstimateGridColumn, tsqft: number, service = false) => {
                  const selected = selectedRowIndexes.includes(rowIndex);
                  const actionCell = renderRowActions(rowIndex, column, selected, item);
                  if (actionCell) return actionCell;
                  if (column.id === "sl") {
                    return (
                      <td key={column.id} className={`num eb-row-number-cell ${column.fixed ? "eb-freeze-cell" : ""} ${isActiveCell(rowIndex, column.id) ? "eb-cell-active" : ""}`} style={cellStyle(column)}>
                        <button
                          type="button"
                          data-cell-key={getCellKey(rowIndex, column.id)}
                          onClick={(event) => {
                            if (event.shiftKey) selectRowRange(rowIndex);
                            else if (event.ctrlKey || event.metaKey) toggleRowSelection(rowIndex);
                            else selectSingleRow(rowIndex);
                          }}
                          onFocus={() => {
                            setActiveCell({ rowIndex, columnId: column.id });
                            if (selectedRowIndexes.length === 0) selectSingleRow(rowIndex);
                          }}
                          onKeyDown={(event) => handleCellKeyDown(event, rowIndex, column.id)}
                        >
                          {item.sl}
                        </button>
                      </td>
                    );
                  }
                  if (column.id === "element") return renderTextInput(item, rowIndex, column, "itemName", item.itemName || "", { fontWeight: 600, placeholder: "Visual" });
                  if (column.id === "materialCode") return renderReadOnlyCell(rowIndex, column, item.materialCode || "Auto", "left", { fontFamily: "monospace", color: item.materialCode ? "#0f172a" : "#94a3b8" });
                  if (column.id === "hsn") return renderTextInput(item, rowIndex, column, "hsn", item.hsn || "", { placeholder: "HSN" });
                  if (column.id === "standard") {
                    const editing = isEditingCell(rowIndex, column.id);
                    return (
                      <td key={column.id} className={cellClassName(rowIndex, column)} style={cellStyle(column)}>
                        <select
                          data-cell-key={getCellKey(rowIndex, column.id)}
                          value={item.isStandard ? "Standard" : "Non-standard"}
                          disabled={!editing}
                          onFocus={() => {
                            selectSingleRow(rowIndex);
                            setActiveCell({ rowIndex, columnId: column.id });
                          }}
                          onDoubleClick={() => beginEditCell(rowIndex, column.id)}
                          onChange={(event) => {
                            const next = [...estItems];
                            next[rowIndex] = { ...next[rowIndex], isStandard: event.target.value === "Standard" };
                            setEstItems(next);
                          }}
                          onBlur={stopEditCell}
                          onKeyDown={(event) => handleCellKeyDown(event, rowIndex, column.id)}
                        >
                          <option value="Standard">Standard</option>
                          <option value="Non-standard">Non</option>
                        </select>
                      </td>
                    );
                  }
                  if (column.id === "product") {
                    if (service) return renderTextInput(item, rowIndex, column, "description", item.description || "", { placeholder: "Product details" });
                    const editing = isEditingCell(rowIndex, column.id);
                    return (
                      <td key={column.id} className={cellClassName(rowIndex, column)} style={cellStyle(column)}>
                        <ProductSearchCell
                          item={item}
                          rowIndex={rowIndex}
                          productOptions={productOptions}
                          readOnly={!editing}
                          cellKey={getCellKey(rowIndex, column.id)}
                          onFocus={() => {
                            selectSingleRow(rowIndex);
                            setActiveCell({ rowIndex, columnId: column.id });
                          }}
                          onDoubleClick={() => beginEditCell(rowIndex, column.id)}
                          onKeyDown={(event) => handleCellKeyDown(event, rowIndex, column.id)}
                          onSelect={handleProductSelectChange}
                          onDetailsChange={(idx, value) => handleEstimateItemChange(idx, "description", value)}
                          onCreateProduct={canCreateProduct ? (name) => handleOpenCreateProduct(rowIndex, name) : undefined}
                        />
                      </td>
                    );
                  }
                  if (column.id === "width" || column.id === "height") {
                    const field = column.id;
                    const editing = isEditingCell(rowIndex, column.id);
                    return (
                      <td key={column.id} className={cellClassName(rowIndex, column, "right")} style={cellStyle(column)}>
                        <SmartSizeInput
                          cellKey={getCellKey(rowIndex, column.id)}
                          value={String(item[field] ?? "")}
                          readOnly={!editing}
                          onFocus={() => {
                            selectSingleRow(rowIndex);
                            setActiveCell({ rowIndex, columnId: column.id });
                          }}
                          onDoubleClick={() => beginEditCell(rowIndex, column.id)}
                          onKeyDown={(event) => handleCellKeyDown(event, rowIndex, column.id)}
                          onChange={(value) => handleEstimateItemChange(rowIndex, field, value)}
                        />
                      </td>
                    );
                  }
                  if (column.id === "quantity") return renderTextInput(item, rowIndex, column, "quantity", item.quantity || "", { align: "right", inputMode: "numeric" });
                  if (column.id === "sqft") return renderReadOnlyCell(rowIndex, column, (service ? (Number(item.quantity) || 0) : tsqft).toFixed(2), "right");
                  if (column.id === "rate") return renderTextInput(item, rowIndex, column, "rate", item.rate || "", { align: "right", inputMode: "decimal", fontWeight: service ? 700 : undefined });
                  if (column.id === "amount") return renderReadOnlyCell(rowIndex, column, (Number(item.amount) || 0).toFixed(2), "right");
                  if (column.id === "gstPercent") return renderReadOnlyCell(rowIndex, column, `${estGstType === "IGST" ? Number(item.igstPercent) || 0 : Number(item.sgstPercent) || 0}%`, "right");
                  if (column.id === "gstAmount") return renderReadOnlyCell(rowIndex, column, (estGstType === "IGST" ? Number(item.igstAmount) || 0 : Number(item.sgstAmount) || 0).toFixed(2), "right");
                  if (column.id === "cgstPercent") return renderReadOnlyCell(rowIndex, column, estGstType === "IGST" ? "" : `${Number(item.cgstPercent) || 0}%`, "right");
                  if (column.id === "cgstAmount") return renderReadOnlyCell(rowIndex, column, estGstType === "IGST" ? "" : (Number(item.cgstAmount) || 0).toFixed(2), "right");
                  if (column.id === "total") return renderReadOnlyCell(rowIndex, column, (Number(item.totalAmount) || 0).toFixed(2), "right", { fontWeight: 700 });
                  return null;
                };
                return (
                  <div className="eb-sheet-body">
                    <div className={`eb-sheet-meta ${headerExpanded ? "" : "is-collapsed"}`}>
                      <div className="eb-compact-estimate-bar">
                        <button type="button" onClick={() => setHeaderExpanded(prev => !prev)} title={headerExpanded ? "Collapse estimate header" : "Show Estimate Details"}>
                          {headerExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                        </button>
                        <b>{compactHeaderBits[0]}</b>
                        <span>{compactHeaderBits[1]}</span>
                        <span>{compactHeaderBits[2]}</span>
                        <strong className={compactHeaderBits[3] === "GST Loaded" ? "ok" : "warn"}>{compactHeaderBits[3]}</strong>
                        {!headerExpanded && (
                          <button type="button" className="eb-show-details-btn" onClick={() => setHeaderExpanded(true)}>
                            <ChevronDown className="w-3.5 h-3.5" /> Show Estimate Details
                          </button>
                        )}
                      </div>
                      {headerExpanded && (
                        <>
                          <label>
                            <span>Estimate No</span>
                            <input required readOnly value={estNumber} placeholder="System generated" className="eb-mono" />
                          </label>
                          <label>
                            <span>Date</span>
                            <input required type="date" value={estDate} onChange={(e) => setEstDate(e.target.value)} />
                          </label>
                          <label className="eb-meta-wide">
                            <span>Subject / Job</span>
                            <input required value={estSubject} onChange={(e) => setEstSubject(e.target.value)} placeholder="e.g. Visual Changeover" />
                          </label>
                          <label>
                            <span>Client *</span>
                            <ClientSearchCell
                              clients={clients}
                              value={estClientId}
                              onSelect={(id) => handleClientSelectChange(id)}
                              onCreateNew={(name) => setCreateClientFor({ initialName: name })}
                              required
                              autoFocus={!editingEstimateId}
                            />
                          </label>
                          <label>
                            <span>Brand{eIsAbfrl ? " *" : ""}</span>
                            <select
                              required={eIsAbfrl}
                              disabled={!eClientIdNum}
                              value={estBrandId}
                              onChange={(e) => handleBrandSelectChange(e.target.value)}
                            >
                              <option value="">
                                {!eClientIdNum
                                  ? "- select client first -"
                                  : linkedBrands.length === 0
                                    ? "- no brand applicable -"
                                    : "- select brand -"}
                              </option>
                              {brandsForDropdown.map(b => (
                                <option key={b.id} value={b.id}>{b.name}</option>
                              ))}
                            </select>
                          </label>
                          {eIsAbfrl ? (
                            <label>
                              <span>Project Type</span>
                              <select
                                value={estAbfrlProjectType}
                                onKeyDown={handleGstStepKeyDown}
                                onChange={(e) => setEstAbfrlProjectType(e.target.value as "SELEX" | "CAPEX")}
                              >
                                <option value="SELEX">SELEX</option>
                                <option value="CAPEX">CAPEX</option>
                              </select>
                            </label>
                          ) : (
                            <label>
                              <span>GST Type</span>
                              <select
                                value={estGstType}
                                onKeyDown={handleGstStepKeyDown}
                                onChange={(e) => setEstGstType(e.target.value)}
                              >
                                <option value="CGST+SGST">CGST + SGST</option>
                                <option value="IGST">IGST</option>
                              </select>
                            </label>
                          )}
                          {clientBillingProfilesList.length > 0 && (
                            <div className="eb-meta-profile">
                              <label>
                                <span>GST Profile</span>
                                <input
                                  value={gstProfileSearch}
                                  onFocus={() => setGstProfileOpen(true)}
                                  onChange={(e) => {
                                    setGstProfileSearch(e.target.value);
                                    setGstProfileOpen(true);
                                    setGstProfileHighlightIndex(0);
                                  }}
                                  onKeyDown={handleGstProfileKeyDown}
                                  placeholder="State, legal name, GSTIN"
                                />
                              </label>
                              {gstProfileOpen && (
                                <div className="eb-profile-menu">
                                  {filteredBillingProfiles.length === 0 ? (
                                    <div className="eb-profile-empty">No matching GST profiles</div>
                                  ) : visibleBillingProfiles.map((bp, optionIndex) => (
                                    <button
                                      key={bp.id}
                                      type="button"
                                      tabIndex={-1}
                                      onMouseDown={(e) => {
                                        e.preventDefault();
                                        applyBillingProfile(bp);
                                        setGstProfileOpen(false);
                                      }}
                                      onMouseEnter={() => setGstProfileHighlightIndex(optionIndex)}
                                      className={optionIndex === gstProfileHighlightIndex || String(bp.id) === String(estBillingProfileId) ? "active" : ""}
                                    >
                                      {normalizeDisplayName(bp.state || bp.branchLocationName)} - {normalizeDisplayName(bp.legalCompanyName)} ({normalizeGstinPan(bp.gstin)})
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                          <details className="eb-sheet-details">
                            <summary>Billing / GST Details</summary>
                            <div className="eb-sheet-details-grid">
                          <label className="eb-detail-wide">
                            <span>Billing To</span>
                            <textarea
                              rows={2}
                              value={estBillingTo}
                              onChange={(e) => setEstBillingTo(e.target.value)}
                              placeholder={"Legal company name on line 1, then full address.\nM/S : <Company>\n<Address line>\n<City, State PIN>"}
                            />
                          </label>
                          <label className="eb-detail-wide">
                            <span>Shipping To</span>
                            <textarea
                              rows={2}
                              value={estShippingTo}
                              onChange={(e) => setEstShippingTo(e.target.value)}
                              placeholder="Leave blank to use Billing To on print."
                            />
                          </label>
                          <label>
                            <span>GSTIN</span>
                            <input className="eb-mono" value={estGstin} onChange={(e) => setEstGstin(e.target.value)} placeholder="GSTIN" />
                          </label>
                          <label>
                            <span>PAN</span>
                            <input className="eb-mono" value={estPan} onChange={(e) => setEstPan(e.target.value)} placeholder="PAN" />
                          </label>
                          <label>
                            <span>State Code</span>
                            <input className="eb-mono" value={estStateCode} onChange={(e) => setEstStateCode(e.target.value)} placeholder="e.g. 27" />
                          </label>
                          <label className="eb-detail-wide">
                            <span>Vendor Code</span>
                            <input
                              className="eb-mono"
                              value={estVendorCode}
                              onChange={(e) => setEstVendorCode(e.target.value)}
                              placeholder="Auto-filled from client master. Leave blank to hide on print/export."
                            />
                          </label>
                            </div>
                          </details>
                          <div className={`eb-company-strip ${missingSellerFields.length > 0 ? "warn" : ""}`}>
                            <b>{sellerProfile?.name || "Company Name Missing"}</b>
                            <span>GST {sellerProfile?.gstin || "Missing"}</span>
                            <span>State Code {sellerProfile?.stateCode || "Missing"}</span>
                            <span>{sellerProfile?.address || "Address Missing"}</span>
                            <span>{sellerContact || "Contact Missing"}</span>
                            {missingSellerFields.length > 0 && <strong>Missing: {missingSellerFields.join(", ")}</strong>}
                          </div>
                        </>
                      )}
                    </div>

                    <div className="eb-v2-shell" tabIndex={-1} onKeyDown={handleWorkspaceKeyDown}>
                      <div className="eb-v2-toolbar">
                        <button type="button" onClick={openStorePickerAndFocusSearch}><Plus className="w-3 h-3" />Add Store</button>
                        <button type="button" onClick={addRowBelowSelection} disabled={activeStoreIds.length === 0}><Plus className="w-3 h-3" />Add Row</button>
                        <button type="button" onClick={copySelectedRows} disabled={selectedRowIndexes.length === 0}><Copy className="w-3 h-3" />Copy</button>
                        <button type="button" onClick={pasteAfterSelection} disabled={!rowClipboard || selectedRowIndexes.length === 0}>Paste</button>
                        <button type="button" onClick={duplicateSelectedRows} disabled={selectedRowIndexes.length === 0}>Duplicate</button>
                        <button type="button" onClick={deleteSelectedRowsAction} disabled={selectedRowIndexes.length === 0}><Trash className="w-3 h-3" />Delete</button>
                        <button type="button" onClick={undoGridChange} disabled={undoStack.length === 0}><Undo2 className="w-3 h-3" />Undo</button>
                        <button type="button" onClick={redoGridChange} disabled={redoStack.length === 0}><Redo2 className="w-3 h-3" />Redo</button>
                        <button type="button" onClick={() => document.querySelector<HTMLInputElement>("[data-est-find-input]")?.focus()}><Search className="w-3 h-3" />Find</button>
                        <button type="button" onClick={replaceInSelectedRows} disabled={!findText}>Replace</button>
                        <button type="button" onClick={() => setShowFilters(prev => !prev)}><Filter className="w-3 h-3" />Filter</button>
                        <span className="eb-v2-toolbar-status">{selectedRowIndexes.length} selected</span>
                      </div>
                      {showFilters && (
                        <div className="eb-v2-filters">
                          <label>Find<input data-est-find-input value={findText} onChange={e => setFindText(e.target.value)} onKeyDown={e => e.key === "Enter" && focusFirstFindMatch()} placeholder="Find" /></label>
                          <label>Replace<input value={replaceText} onChange={e => setReplaceText(e.target.value)} placeholder="Replace with" /></label>
                          <label>Element<input value={rowFilterElement} onChange={e => setRowFilterElement(e.target.value)} placeholder="Visual" /></label>
                          <label>Product<input value={rowFilterProduct} onChange={e => setRowFilterProduct(e.target.value)} placeholder="Product details" /></label>
                          <label>Store<input value={rowFilterStore} onChange={e => setRowFilterStore(e.target.value)} placeholder="Store / code" /></label>
                          <label>City<input value={rowFilterCity} onChange={e => setRowFilterCity(e.target.value)} placeholder="City" /></label>
                          <div className="eb-v2-visible">
                            <b>{visibleProductRowsAll.length}</b> visible
                            <span>Qty {filteredSummary.qty.toFixed(0)}</span>
                            <span>Sqft {filteredSummary.sqft.toFixed(2)}</span>
                            <span>Material {formatCurrency(filteredSummary.materialValue)}</span>
                            <button type="button" onClick={clearRowFilters}>Clear</button>
                          </div>
                        </div>
                      )}
                      {showFilters && elementMetrics.length > 0 && (
                        <div className="eb-v2-metrics">
                          {elementMetrics.map(([element, qty]) => (
                            <button
                              key={element}
                              type="button"
                              onClick={() => setRowFilterElement(String(element))}
                              className={rowFilterElement === element ? "active" : ""}
                            >
                              {element} = {Number(qty).toFixed(0)} Qty
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="eb-v2-summary">
                        <span>Stores <b>{activeStoreIds.length}</b></span>
                        <span>Rows <b>{productRowsAll.length}</b></span>
                        <span>Qty <b>{productRowsAll.reduce((s: number, r: any) => s + (Number(r.quantity) || 0), 0).toFixed(0)}</b></span>
                        <span>Sqft <b>{productRowsAll.reduce((s: number, r: any) => {
                          const w = Number(r.width) || 0;
                          const h = Number(r.height) || 0;
                          const q = Number(r.quantity) || 0;
                          const sqft = r.calculationType === "running_inch" ? w * h * q : (w * h * q) / 144;
                          return s + sqft;
                        }, 0).toFixed(2)}</b></span>
                        <span>Material Value <b>{formatCurrency(grandMaterial)}</b></span>
                        <span>Estimate Total <b>{formatCurrency(grandTotal)}</b></span>
                      </div>

                      {(storePickerOpen || (activeStoreIds.length === 0 && storeEntryBlocked)) && (
                        <div className="eb-store-picker-panel">
                          {storeEntryBlocked ? (
                            <div className="eb-store-gate">
                              {eIsAbfrl
                                ? "Select Client and Brand first."
                                : "Select Client first."}
                            </div>
                          ) : null}
                          {storePickerOpen && !storeEntryBlocked && (
                            <div className="eb-store-picker">
                              {!eIsAbfrl && (
                                <div className="eb-manual-store">
                                  <input
                                    value={manualStoreName}
                                    onChange={(e) => setManualStoreName(e.target.value)}
                                    placeholder="Manual Store / Site / Location name"
                                  />
                                  <input
                                    value={manualStoreLocation}
                                    onChange={(e) => setManualStoreLocation(e.target.value)}
                                    placeholder="Address / City / State details"
                                  />
                                  <button type="button" onClick={addManualStore} disabled={!manualStoreName.trim()}>
                                    Add Manual Site
                                  </button>
                                </div>
                              )}
                              <div className="eb-store-search-row">
                                <input
                                  autoFocus
                                  data-est-store-search
                                  value={storeSearch}
                                  onChange={(e) => {
                                    setStoreSearch(e.target.value);
                                    setStoreHighlightIndex(0);
                                  }}
                                  onKeyDown={handleStoreSearchKeyDown}
                                  placeholder="Type store code, name, city, state, region, location..."
                                />
                                <button type="button" onClick={() => addStores(pendingStoreIds)} disabled={pendingStoreIds.length === 0}>
                                  Add ({pendingStoreIds.length})
                                </button>
                                <button type="button" onClick={() => setStorePickerOpen(false)}>Close</button>
                              </div>
                              <div className="eb-store-results">
                                {filteredStores.length === 0 ? (
                                  <div className="eb-store-empty">
                                    {storeSearch
                                      ? "No matching stores."
                                      : eIsAbfrl
                                        ? "No more stores available for this client/brand."
                                        : eClientIdNum
                                          ? "No linked stores available for this client. Type a manual site above."
                                          : "Select a client to see linked stores, or type a manual site above."}
                                  </div>
                                ) : (
                                  visibleStores.map((s, optionIndex) => {
                                    const sid = String(s.id);
                                    const checked = pendingStoreIds.includes(sid);
                                    return (
                                      <label
                                        key={s.id}
                                        onMouseEnter={() => setStoreHighlightIndex(optionIndex)}
                                        className={optionIndex === storeHighlightIndex ? "active" : ""}
                                      >
                                        <input
                                          type="checkbox"
                                          tabIndex={-1}
                                          checked={checked}
                                          onChange={(e) => {
                                            setPendingStoreIds((prev) => e.target.checked
                                              ? Array.from(new Set([...prev, sid]))
                                              : prev.filter(id => id !== sid));
                                          }}
                                        />
                                        <span>{storeDisplay(s)}</span>
                                      </label>
                                    );
                                  })
                                )}
                                {filteredStores.length > 80 && (
                                  <div className="eb-store-more">Showing first 80 matches. Type more to narrow the list.</div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      <div className="eb-sheet-grid-viewport">
                        {activeStoreIds.length === 0 && (
                          <div className="eb-empty-sheet">
                            Select a store to begin the estimate.
                          </div>
                        )}

                    {storeBreakdown.map(({ sid, productRows, packingRows, installRows, transportRows, materialBase, materialSgst, materialCgst, materialIgst }) => {
                      const store = stores.find(s => String(s.id) === sid);
                      const hasPacking = packingRows.length > 0;
                      const hasInstall = installRows.length > 0;
                      const hasTransport = transportRows.length > 0;
                      const collapsed = collapsedStoreIds.includes(sid);
                      const previousStoreId = activeStoreIds[activeStoreIds.indexOf(sid) - 1] || "";
                      const nextStoreId = activeStoreIds[activeStoreIds.indexOf(sid) + 1] || "";
                      const storeNameLabel = store?.name || estStoreOverrides[sid]?.storeName || `#${sid}`;
                      const storeCodeLabel = store?.storeCode || "";
                      const storeCityLabel = store?.city || estStoreOverrides[sid]?.storeCity || estStoreOverrides[sid]?.storeLocation || "";
                      return (
                        <div key={`store-${sid}`} className="eb-store-block">
                          <table className="eb-grid">
                            <thead>
                              <tr>
                                <th colSpan={tableCols} className="eb-store-header">
                                  <div className="eb-store-header-row">
                                    <div className="eb-store-title-wrap">
                                    {(() => {
                                      const storeRowIndexes = estItems
                                        .map((r: any, i: number) => ({ r, i }))
                                        .filter(({ r }) => String(r.storeId || "") === sid)
                                        .map(({ i }) => i);
                                      const allSelected = storeRowIndexes.length > 0 && storeRowIndexes.every(i => selectedRowIndexes.includes(i));
                                      return (
                                        <input
                                          type="checkbox"
                                          title="Select all rows in this store"
                                          checked={allSelected}
                                          onChange={() => {
                                            if (allSelected) {
                                              setSelectedRowIndexes(prev => prev.filter(i => !storeRowIndexes.includes(i)));
                                            } else {
                                              setSelectedRowIndexes(prev => Array.from(new Set([...prev, ...storeRowIndexes])));
                                            }
                                          }}
                                          style={{ cursor: "pointer", flex: "0 0 auto" }}
                                        />
                                      );
                                    })()}
                                    <button
                                      type="button"
                                      className="eb-store-toggle"
                                      onClick={() => setCollapsedStoreIds(prev => prev.includes(sid) ? prev.filter(id => id !== sid) : [...prev, sid])}
                                      title={collapsed ? "Expand store" : "Collapse store"}
                                    >
                                      {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                                      {renamingStoreId === sid ? (
                                        <input
                                          type="text"
                                          autoFocus
                                          value={renamingStoreName}
                                          onChange={e => setRenamingStoreName(e.target.value)}
                                          onKeyDown={e => {
                                            e.stopPropagation();
                                            if (e.key === "Enter") {
                                              const name = renamingStoreName.trim() || (estStoreOverrides[sid]?.storeName || `Store ${sid}`);
                                              setEstStoreOverrides((prev: Record<string, any>) => ({ ...prev, [sid]: { ...prev[sid], storeName: name } }));
                                              setRenamingStoreId(null);
                                            }
                                            if (e.key === "Escape") {
                                              setRenamingStoreId(null);
                                              setRenamingStoreName("");
                                            }
                                          }}
                                          onBlur={() => {
                                            if (renamingStoreName.trim()) {
                                              setEstStoreOverrides((prev: Record<string, any>) => ({ ...prev, [sid]: { ...prev[sid], storeName: renamingStoreName.trim() } }));
                                            }
                                            setRenamingStoreId(null);
                                            setRenamingStoreName("");
                                          }}
                                          onClick={e => e.stopPropagation()}
                                          style={{ fontWeight: 800, fontSize: 11, background: "#fff", border: "2px solid #2563eb", borderRadius: 2, padding: "0 4px", height: 18, color: "#0f172a", minWidth: 180 }}
                                        />
                                      ) : (
                                        <span
                                          className="eb-store-title-group"
                                          onDoubleClick={e => {
                                            e.stopPropagation();
                                            setRenamingStoreId(sid);
                                            setRenamingStoreName(storeNameLabel);
                                          }}
                                          title="Double-click to rename"
                                        >
                                          <span className="eb-store-name">{storeNameLabel}</span>
                                          {storeCodeLabel && <span className="eb-store-code">{storeCodeLabel}</span>}
                                          {storeCityLabel && <span className="eb-store-city">{storeCityLabel}</span>}
                                        </span>
                                      )}
                                    </button>
                                    </div>
                                    <div className="eb-store-actions">
                                      <button type="button" onClick={() => addRowToStore(sid)} title="Add row">
                                        <Plus className="w-3.5 h-3.5" /><span>+ Row</span>
                                      </button>
                                      <button type="button"
                                        onClick={() => { setPasteModalStoreId(sid); setPasteText(""); setPasteError(""); setPastePreviewRows?.([]); }}
                                        title="Paste multiple rows copied from Excel"
                                      >
                                        <ClipboardPaste className="w-3.5 h-3.5" /><span>Paste XL</span>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const rowIndexes = estItems
                                            .map((r: any, i: number) => ({ r, i }))
                                            .filter(({ r }) => String(r.storeId || "") === sid)
                                            .map(({ i }) => i);
                                          copyEstimateItemToClipboard(rowIndexes);
                                        }}
                                        title="Copy all rows of this store to clipboard (then select another store and Ctrl+V to paste)"
                                      >
                                        <Copy className="w-3.5 h-3.5" /><span>Copy Store</span>
                                      </button>
                                      <button type="button" onClick={() => duplicateStore(sid)} title="Duplicate store with all its rows">
                                        <FileSpreadsheet className="w-3.5 h-3.5" /><span>Duplicate</span>
                                      </button>
                                      <button type="button" onClick={() => moveStore(sid, "up")} disabled={!previousStoreId} title="Move store up">
                                        <MoveUp className="w-3.5 h-3.5" /><span>↑</span>
                                      </button>
                                      <button type="button" onClick={() => moveStore(sid, "down")} disabled={!nextStoreId} title="Move store down">
                                        <MoveDown className="w-3.5 h-3.5" /><span>↓</span>
                                      </button>
                                      <button type="button" onClick={() => removeStore(sid)} title="Delete store and all its rows" className="danger">
                                        <Trash className="w-3.5 h-3.5" /><span>Delete</span>
                                      </button>
                                    </div>
                                  </div>
                                </th>
                              </tr>
                              {!collapsed && <tr>
                                {gridColumns.map((column) => (
                                  <th
                                    key={column.id}
                                    draggable={!column.fixed}
                                    onDragStart={(event) => {
                                      if (column.fixed) return;
                                      setDragColumnId(column.id);
                                      event.dataTransfer.effectAllowed = "move";
                                    }}
                                    onDragOver={(event) => {
                                      if (!column.fixed && dragColumnId) event.preventDefault();
                                    }}
                                    onDrop={(event) => {
                                      event.preventDefault();
                                      if (dragColumnId) moveColumn(dragColumnId, column.id);
                                      setDragColumnId(null);
                                    }}
                                    onDragEnd={() => setDragColumnId(null)}
                                    className={`eb-col-header ${column.fixed ? "eb-freeze-head" : ""} ${dragColumnId === column.id ? "eb-col-dragging" : ""}`}
                                    style={{ ...cellStyle(column), position: "sticky", top: 32, zIndex: column.fixed ? 25 : 20, background: column.fixed ? "#e5e7eb" : "#f1f5f9" }}
                                  >
                                    <span>{column.label}</span>
                                    {!column.fixed && <span className="eb-col-drag-hint">⋮⋮</span>}
                                    <span
                                      className="eb-col-resize"
                                      onMouseDown={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        const startX = event.clientX;
                                        const startWidth = column.width;
                                        const onMove = (moveEvent: MouseEvent) => {
                                          resizeColumn(column.id, startWidth + moveEvent.clientX - startX);
                                        };
                                        const onUp = () => {
                                          window.removeEventListener("mousemove", onMove);
                                          window.removeEventListener("mouseup", onUp);
                                        };
                                        window.addEventListener("mousemove", onMove);
                                        window.addEventListener("mouseup", onUp);
                                      }}
                                    />
                                  </th>
                                ))}
                              </tr>}
                            </thead>
                            {!collapsed && <tbody>
                              {/* Product rows only */}
                              {productRows.filter(rowMatchesFilters).map((item) => {
                                const idx = estItems.indexOf(item);
                                if (idx < 0) return null;
                                const selected = selectedRowIndexes.includes(idx);
                                // Auto-detected T.Sqft for the grid display.
                                // Area-based rows show real area; piece-based
                                // rows show 0 so the column reflects the rule
                                // the engine uses (Sqft > 0 → area math).
                                const w = Number(item.width) || 0;
                                const h = Number(item.height) || 0;
                                const q = Number(item.quantity) || 0;
                                const tsqft = item.calculationType === "running_inch"
                                  ? w * h * q
                                  : (w * h * q) / 144;
                                return (
                                  <tr
                                    key={`r-${idx}`}
                                    className={selected ? "eb-row-selected" : ""}
                                    onClick={(event) => {
                                      if ((event.target as HTMLElement).closest("input, select, textarea, button")) return;
                                      selectSingleRow(idx);
                                    }}
                                  >
                                    {gridColumns.map(column => renderEstimateCell(item, idx, column, tsqft, false))}
                                  </tr>
                                );
                              })}

                              {/* Packing/Installation/Transport line items (if added) */}
                              {[...packingRows, ...installRows, ...transportRows].map((item) => {
                                const idx = estItems.indexOf(item);
                                if (idx < 0) return null;
                                const selected = selectedRowIndexes.includes(idx);
                                const serviceSqft = Number(item.quantity) || 0;
                                return (
                                  <tr
                                    key={`r-${idx}`}
                                    className={selected ? "eb-row-selected" : ""}
                                    style={{ background: "#fffbeb" }}
                                    onClick={(event) => {
                                      if ((event.target as HTMLElement).closest("input, select, textarea, button")) return;
                                      selectSingleRow(idx);
                                    }}
                                  >
                                    {gridColumns.map(column => renderEstimateCell(item, idx, column, serviceSqft, true))}
                                  </tr>
                                );
                              })}

                              <tr className="yellow">
                                {gridColumns.map((column) => {
                                  const value =
                                    column.id === "element" ? "Material Total"
                                      : column.id === "amount" ? materialBase.toFixed(2)
                                        : column.id === "gstPercent" ? (estGstType === "IGST" ? "18%" : "9%")
                                          : column.id === "gstAmount" ? (estGstType === "IGST" ? materialIgst : materialSgst).toFixed(2)
                                            : column.id === "cgstPercent" ? (estGstType === "IGST" ? "" : "9%")
                                              : column.id === "cgstAmount" ? (estGstType === "IGST" ? "" : materialCgst.toFixed(2))
                                                : column.id === "total" ? (materialBase + materialSgst + materialCgst + materialIgst).toFixed(2)
                                                  : "";
                                  return (
                                    <td
                                      key={column.id}
                                      className={`${["amount", "gstPercent", "gstAmount", "cgstPercent", "cgstAmount", "total"].includes(column.id) ? "num" : ""} ${column.fixed ? "eb-freeze-cell" : ""}`}
                                      style={cellStyle(column, column.id === "element" ? { fontWeight: 800 } : {})}
                                    >
                                      {value}
                                    </td>
                                  );
                                })}
                              </tr>

                              {/* Action buttons to add Packing/Installation/Transport */}
                              <tr>
                                <td colSpan={tableCols} style={{ padding: "8px 6px", background: "#f8fafc", borderTop: "2px solid #cbd5e1" }}>
                                  <div className="flex items-center gap-2">
                                    <span className="text-[10px] font-bold text-slate-600 uppercase">Add Service Charges:</span>
                                    <button type="button"
                                      onClick={() => addPackingItem(sid)}
                                      disabled={hasPacking}
                                      className="px-2 py-0.5 bg-amber-600 hover:bg-amber-500 text-white text-[10px] font-bold border border-amber-700 disabled:opacity-40 disabled:cursor-not-allowed"
                                      style={{ borderRadius: 0 }}>
                                      + Packing
                                    </button>
                                    <button type="button"
                                      onClick={() => addInstallationItem(sid)}
                                      disabled={hasInstall}
                                      className="px-2 py-0.5 bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-bold border border-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
                                      style={{ borderRadius: 0 }}>
                                      + Installation
                                    </button>
                                    <button type="button"
                                      onClick={() => addTransportItem(sid, "local")}
                                      disabled={hasTransport}
                                      className="px-2 py-0.5 bg-green-600 hover:bg-green-500 text-white text-[10px] font-bold border border-green-700 disabled:opacity-40 disabled:cursor-not-allowed"
                                      style={{ borderRadius: 0 }}>
                                      + Local Transport
                                    </button>
                                    <button type="button"
                                      onClick={() => addTransportItem(sid, "outstation")}
                                      disabled={hasTransport}
                                      className="px-2 py-0.5 bg-green-600 hover:bg-green-500 text-white text-[10px] font-bold border border-green-700 disabled:opacity-40 disabled:cursor-not-allowed"
                                      style={{ borderRadius: 0 }}>
                                      + Outstation
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            </tbody>}
                          </table>
                        </div>
                      );
                    })}

                      </div>
                    </div>

                    {/* Grand totals */}
                    {activeStoreIds.length > 0 && (
                      <table className="w-full border-collapse text-[11px]">
                        <tbody>
                          <tr>
                            <td className="eb-cell" style={{ width: "70%", textAlign: "right", fontWeight: 700 }}>TOTAL AMOUNT BEFORE TAX</td>
                            <td className="eb-cell num" style={{ width: "30%", fontWeight: 700 }}>{formatCurrency(grandMaterial)}</td>
                          </tr>
                          {estGstType !== "IGST" && (
                            <>
                              <tr>
                                <td className="eb-cell" style={{ textAlign: "right", fontWeight: 700 }}>Add : CGST 9%</td>
                                <td className="eb-cell num" style={{ fontWeight: 700 }}>{formatCurrency(grandCgst)}</td>
                              </tr>
                              <tr>
                                <td className="eb-cell" style={{ textAlign: "right", fontWeight: 700 }}>Add : SGST 9%</td>
                                <td className="eb-cell num" style={{ fontWeight: 700 }}>{formatCurrency(grandSgst)}</td>
                              </tr>
                            </>
                          )}
                          {estGstType === "IGST" && (
                            <tr>
                              <td className="eb-cell" style={{ textAlign: "right", fontWeight: 700 }}>Add : IGST 18%</td>
                              <td className="eb-cell num" style={{ fontWeight: 700 }}>{formatCurrency(grandIgst)}</td>
                            </tr>
                          )}
                          <tr>
                            <td className="eb-cell" style={{ textAlign: "right", fontWeight: 700, background: "#fef3c7" }}>TOTAL AMOUNT AFTER TAX</td>
                            <td className="eb-cell num" style={{ fontWeight: 800, background: "#fef3c7" }}>{formatCurrency(grandTotal)}</td>
                          </tr>
                        </tbody>
                      </table>
                    )}
                  </div>
                );
              })()}
              <div className="eb-sheet-savebar">
                <span className="eb-sheet-savebar-hint">Ctrl+S save · Ctrl+Shift+S add store · F2/Enter edit · Tab/Enter=next · Shift+Tab/Enter=prev · Alt+Enter=insert row · Ctrl+A=select all</span>
                {props.isDirty && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "#92400e", background: "#fef3c7", border: "1px solid #f59e0b", borderRadius: 4, padding: "1px 8px", fontSize: 10, fontWeight: 700, flexShrink: 0 }}>
                    ● Unsaved changes
                  </span>
                )}
                {props.lastSavedAt && !props.isDirty && (
                  <span style={{ color: "#065f46", fontSize: 10, fontWeight: 600, flexShrink: 0 }}>
                    Saved {(props.lastSavedAt as Date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (estItems.filter((r: any) => r.lineType === "product" || !r.lineType).length > 0
                      && !window.confirm("Discard unsaved estimate?")) return;
                    setShowEstimateForm(false);
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="eb-save-primary"
                  disabled={!!isSaving}
                  onClick={() => console.log(`[save] button click`, { editingEstimateId, isSaving })}
                >
                  {isSaving ? "Saving..." : (editingEstimateId ? "Update Estimate" : "Save Draft Estimate")}
                </button>
              </div>

              {/* Inline product creation drawer */}
              {createProductFor && (
                <CreateProductDrawer
                  initialName={createProductFor.initialName}
                  token={props.token || ""}
                  categories={productCategories}
                  hsnCodes={productHsnCodes}
                  onSaveAndUse={handleProductCreatedAndUse}
                  onCancel={() => {
                    setCreateProductFor(null);
                    // Return focus to the product cell
                    window.requestAnimationFrame(() => {
                      const input = document.querySelector<HTMLInputElement>(`input[data-est-product-index="${createProductFor.rowIndex}"]`);
                      input?.focus();
                    });
                  }}
                />
              )}

              {createClientFor && (
                <CreateClientDrawer
                  initialName={createClientFor.initialName}
                  token={props.token || ""}
                  onSaveAndUse={handleClientCreatedAndUse}
                  onCancel={() => setCreateClientFor(null)}
                />
              )}

              {/* Paste-from-Excel modal — multi-row paste into the current store. */}
              {pasteModalStoreId && (
                <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4" onClick={() => { setPasteModalStoreId(null); setPastePreviewRows?.([]); }}>
                  <div className="bg-white border border-slate-500 w-full max-w-3xl" style={{ borderRadius: 0 }} onClick={(e) => e.stopPropagation()}>
                    <div className="bg-slate-100 border-b border-slate-400 px-3 py-2 flex items-center justify-between">
                      <div className="text-[12px] font-black uppercase tracking-wide text-slate-800">Paste rows from Excel</div>
                      <button type="button" onClick={() => { setPasteModalStoreId(null); setPastePreviewRows?.([]); }}
                        className="text-slate-500 hover:text-slate-900 text-lg leading-none px-1">×</button>
                    </div>
                    <div className="p-3 space-y-2 text-[11px] text-slate-700">
                      <div>
                        Copy rows from Excel and paste below. Expected columns (left → right):
                        <div className="mt-1 font-mono bg-slate-50 border border-slate-300 px-2 py-1">
                          ELEMENT  |  HSN  |  Standard/Non  |  Product Details  |  Width  |  Height  |  Qty  |  Rate
                        </div>
                        <div className="mt-1 text-slate-500">
                          T.Sqft, Amount, SGST, CGST and Total are auto-calculated from W × H × Qty × Rate.
                          A leading SL/numbering column is auto-detected and dropped. Paste tab-separated columns copied directly from Excel.
                        </div>
                      </div>
                      <textarea
                        value={pasteText}
                        onChange={(e) => { setPasteText(e.target.value); setPasteError(""); setPastePreviewRows?.([]); }}
                        autoFocus
                        rows={10}
                        className="w-full border border-slate-400 font-mono text-[11px] p-2"
                        style={{ borderRadius: 0 }}
                        placeholder={"Facade 1\t3921\tStandard\tSolvent Print on Star Flex\t132\t48\t1\t18\nVisual 1\t3921\tStandard\tUV print on Backlit Fabric\t24\t36\t1\t110"}
                      />
                      {pasteError && <div className="text-red-600 text-[11px] font-semibold">{pasteError}</div>}
                      {pastePreviewRows.length > 0 && (
                        <div className="border border-slate-300">
                          <div className="bg-slate-50 border-b border-slate-300 px-2 py-1 text-[10px] font-black uppercase text-slate-600">
                            Preview rows to import ({pastePreviewRows.length})
                          </div>
                          <div className="max-h-48 overflow-auto">
                            <table className="w-full border-collapse text-[10px]">
                              <thead className="bg-slate-100 sticky top-0">
                                <tr>
                                  <th className="border border-slate-300 px-1 py-1 text-left">ELEMENT</th>
                                  <th className="border border-slate-300 px-1 py-1 text-left">HSN</th>
                                  <th className="border border-slate-300 px-1 py-1 text-left">Standard/Non</th>
                                  <th className="border border-slate-300 px-1 py-1 text-left">Product Details</th>
                                  <th className="border border-slate-300 px-1 py-1 text-right">W</th>
                                  <th className="border border-slate-300 px-1 py-1 text-right">H</th>
                                  <th className="border border-slate-300 px-1 py-1 text-right">Qty</th>
                                  <th className="border border-slate-300 px-1 py-1 text-right">Rate</th>
                                </tr>
                              </thead>
                              <tbody>
                                {pastePreviewRows.map((row: any, index: number) => (
                                  <tr key={index}>
                                    <td className="border border-slate-200 px-1 py-1">{row.itemName}</td>
                                    <td className="border border-slate-200 px-1 py-1">{row.hsn}</td>
                                    <td className="border border-slate-200 px-1 py-1">{row.isStandard === false ? "Non-standard" : "Standard"}</td>
                                    <td className="border border-slate-200 px-1 py-1">{row.description}</td>
                                    <td className="border border-slate-200 px-1 py-1 text-right">{row.width}</td>
                                    <td className="border border-slate-200 px-1 py-1 text-right">{row.height}</td>
                                    <td className="border border-slate-200 px-1 py-1 text-right">{row.quantity}</td>
                                    <td className="border border-slate-200 px-1 py-1 text-right">{row.rate}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="border-t border-slate-300 px-3 py-2 flex justify-end gap-2 bg-slate-50">
                      <button type="button" onClick={() => { setPasteModalStoreId(null); setPastePreviewRows?.([]); }}
                        className="py-1 px-3 bg-white hover:bg-slate-100 border border-slate-400 text-slate-700 text-[11px] font-bold"
                        style={{ borderRadius: 0 }}>Cancel</button>
                      {pastePreviewRows.length === 0 ? (
                        <button type="button" onClick={previewExcelPaste}
                          className="py-1 px-4 bg-slate-800 hover:bg-slate-700 text-white text-[11px] font-black border border-slate-900"
                          style={{ borderRadius: 0 }}>Preview rows</button>
                      ) : (
                        <button type="button" onClick={applyExcelPaste}
                        className="py-1 px-4 bg-orange-600 hover:bg-orange-500 text-white text-[11px] font-black border border-orange-700"
                          style={{ borderRadius: 0 }}>Confirm Add Rows</button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </form>
          )}
        </div>
  );
};

export default EstimateBuilder;
