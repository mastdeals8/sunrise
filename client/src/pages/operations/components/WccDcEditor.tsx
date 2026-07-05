import React from "react";
import { Copy, Download, Plus, Printer, X } from "lucide-react";
import type { Estimate, WccPhoto } from "../types";
import { isAblblFormat } from "../../../../../shared/textFormat";
import { companyAssetUrl } from "../../../utils/companyAssets";
import { orderedStoreKeysFromItems } from "../utils/estimateOrdering";

// ============================================================
// WccPictureArea — PowerPoint-style free-positioning canvas for
// WCC proof photos. Each photo has xPct/yPct (top/left) + wPct/hPct
// (size within frame). When `editable`:
//   * click a photo → selection (8 handles: 4 corners + 4 edges)
//   * drag body → move
//   * corner handle → resize preserving aspect ratio (Shift = free)
//   * edge handle → resize one axis
//   * right-click → Bring to Front / Send to Back / Delete
// Selection lives in the parent (selectedIdx / setSelectedIdx) so
// the modal-level keyboard listener can Delete / Esc.
// Falls back to a tile grid for legacy WCCs without xPct/yPct.
// ============================================================
type ResizeMode =
  | "move"
  | "resize-nw" | "resize-n" | "resize-ne"
  | "resize-e" | "resize-se" | "resize-s"
  | "resize-sw" | "resize-w";

export const WccPictureArea: React.FC<{
  photos: WccPhoto[];
  editable: boolean;
  onChange?: (next: WccPhoto[]) => void;
  onFiles?: (files: File[] | FileList | null) => void;
  selectedIdx?: number | null;
  setSelectedIdx?: (idx: number | null) => void;
  onDeletePhoto?: (idx: number) => void;
}> = ({ photos, editable, onChange, onFiles, selectedIdx = null, setSelectedIdx, onDeletePhoto }) => {
  const frameRef = React.useRef<HTMLDivElement | null>(null);
  const [contextMenu, setContextMenu] = React.useState<null | { x: number; y: number; idx: number }>(null);
  const dragRef = React.useRef<null | {
    idx: number;
    mode: ResizeMode;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    origW: number;
    origH: number;
    aspect: number;
    frameW: number;
    frameH: number;
    shiftDown: boolean;
  }>(null);

  const beginDrag = (e: React.MouseEvent, idx: number, mode: ResizeMode) => {
    if (!editable) return;
    e.preventDefault();
    e.stopPropagation();
    const frame = frameRef.current;
    if (!frame) return;
    const rect = frame.getBoundingClientRect();
    const p = photos[idx];
    const origW = p.wPct ?? 30;
    const origH = p.hPct ?? 30;
    dragRef.current = {
      idx,
      mode,
      startX: e.clientX,
      startY: e.clientY,
      origX: p.xPct ?? 0,
      origY: p.yPct ?? 0,
      origW,
      origH,
      aspect: origH > 0 ? origW / origH : 1,
      frameW: rect.width,
      frameH: rect.height,
      shiftDown: e.shiftKey,
    };
    if (setSelectedIdx) setSelectedIdx(idx);
    bringToFront(idx);

    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current || !onChange) return;
      const { idx, mode, startX, startY, origX, origY, origW, origH, aspect, frameW, frameH } = dragRef.current;
      const dxPct = ((ev.clientX - startX) / frameW) * 100;
      const dyPct = ((ev.clientY - startY) / frameH) * 100;
      const preserveAspect = !ev.shiftKey; // shift toggles OFF constraint
      const next = [...photos];
      const cur = { ...next[idx] };

      if (mode === "move") {
        cur.xPct = clamp(origX + dxPct, 0, 100 - origW);
        cur.yPct = clamp(origY + dyPct, 0, 100 - origH);
      } else {
        // Compute unconstrained new box based on which handle is dragged.
        let nx = origX, ny = origY, nw = origW, nh = origH;
        if (mode === "resize-e")  { nw = origW + dxPct; }
        if (mode === "resize-w")  { nx = origX + dxPct; nw = origW - dxPct; }
        if (mode === "resize-s")  { nh = origH + dyPct; }
        if (mode === "resize-n")  { ny = origY + dyPct; nh = origH - dyPct; }
        if (mode === "resize-se") { nw = origW + dxPct; nh = origH + dyPct; }
        if (mode === "resize-sw") { nx = origX + dxPct; nw = origW - dxPct; nh = origH + dyPct; }
        if (mode === "resize-ne") { ny = origY + dyPct; nw = origW + dxPct; nh = origH - dyPct; }
        if (mode === "resize-nw") { nx = origX + dxPct; ny = origY + dyPct; nw = origW - dxPct; nh = origH - dyPct; }

        // For corner drags, preserve aspect ratio unless Shift is held.
        const isCorner = mode === "resize-se" || mode === "resize-sw" || mode === "resize-ne" || mode === "resize-nw";
        if (isCorner && preserveAspect && aspect > 0) {
          // Pick whichever axis moved further as the driver.
          const useW = Math.abs(nw - origW) >= Math.abs(nh - origH);
          if (useW) {
            nh = nw / aspect;
            if (mode === "resize-nw" || mode === "resize-ne") ny = origY + (origH - nh);
          } else {
            nw = nh * aspect;
            if (mode === "resize-nw" || mode === "resize-sw") nx = origX + (origW - nw);
          }
        }

        // Enforce mins + frame bounds.
        const MIN = 5;
        if (nw < MIN) { if (mode.includes("w")) nx = origX + origW - MIN; nw = MIN; }
        if (nh < MIN) { if (mode.includes("n")) ny = origY + origH - MIN; nh = MIN; }
        if (nx < 0) { nw += nx; nx = 0; }
        if (ny < 0) { nh += ny; ny = 0; }
        if (nx + nw > 100) nw = 100 - nx;
        if (ny + nh > 100) nh = 100 - ny;

        cur.xPct = nx; cur.yPct = ny; cur.wPct = nw; cur.hPct = nh;
      }
      next[idx] = cur;
      onChange(next);
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const handleDrop = (e: React.DragEvent) => {
    if (!editable || !onFiles) return;
    e.preventDefault();
    e.stopPropagation();
    onFiles(e.dataTransfer.files);
  };

  const cursorFor = (mode: ResizeMode): string => {
    switch (mode) {
      case "resize-n": case "resize-s": return "ns-resize";
      case "resize-e": case "resize-w": return "ew-resize";
      case "resize-ne": case "resize-sw": return "nesw-resize";
      case "resize-nw": case "resize-se": return "nwse-resize";
      default: return "move";
    }
  };

  const renderHandle = (idx: number, mode: ResizeMode, style: React.CSSProperties) => (
    <div
      onMouseDown={(e) => beginDrag(e, idx, mode)}
      title="Drag to resize (Shift = free aspect)"
      style={{
        position: "absolute",
        width: 10,
        height: 10,
        background: "#2563eb",
        cursor: cursorFor(mode),
        border: "1.5px solid #fff",
        borderRadius: 2,
        boxShadow: "0 0 0 1px rgba(0,0,0,0.15)",
        zIndex: 10,
        ...style,
      }}
    />
  );

  const bringToFront = (idx: number) => {
    if (!editable || !onChange) return;
    const maxZ = photos.reduce((m, p) => Math.max(m, p.z ?? 0), 0);
    if ((photos[idx].z ?? 0) === maxZ) return;
    const next = photos.map((p, i) => i === idx ? { ...p, z: maxZ + 1 } : p);
    onChange(next);
  };

  const sendToBack = (idx: number) => {
    if (!editable || !onChange) return;
    const minZ = photos.reduce((m, p) => Math.min(m, p.z ?? 0), 0);
    const next = photos.map((p, i) => i === idx ? { ...p, z: minZ - 1 } : p);
    onChange(next);
  };

  // Legacy fallback layout when no photo has xPct/yPct yet.
  const hasFreePositions = photos.some(p => typeof p.xPct === "number");

  return (
    <div
      ref={frameRef}
      className="flex-1 wcc-cell relative overflow-hidden"
      style={{ minHeight: "85mm", background: "#fff" }}
      onDragOver={(e) => { if (editable) e.preventDefault(); }}
      onDrop={handleDrop}
      onMouseDown={(e) => {
        // Background click → deselect
        if (e.target === e.currentTarget && setSelectedIdx) setSelectedIdx(null);
        setContextMenu(null);
      }}
    >
      {photos.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-slate-400 italic text-xs pointer-events-none">
          Drop, paste (⌘/Ctrl+V), or click "Add Photos" to upload proof images.
        </div>
      )}
      {hasFreePositions
        ? photos.map((p, idx) => {
            const isSelected = editable && selectedIdx === idx;
            return (
              <div
                key={idx}
                onMouseDown={(e) => { if (editable && (e.target as HTMLElement).dataset.handle !== "1") beginDrag(e, idx, "move"); }}
                onContextMenu={(e) => {
                  if (!editable) return;
                  e.preventDefault();
                  const frame = frameRef.current?.getBoundingClientRect();
                  if (setSelectedIdx) setSelectedIdx(idx);
                  setContextMenu({ x: e.clientX - (frame?.left ?? 0), y: e.clientY - (frame?.top ?? 0), idx });
                }}
                className="absolute"
                style={{
                  left: `${p.xPct ?? 0}%`,
                  top: `${p.yPct ?? 0}%`,
                  width: `${p.wPct ?? 30}%`,
                  height: `${p.hPct ?? 30}%`,
                  zIndex: p.z ?? idx,
                  cursor: editable ? "move" : "default",
                  outline: isSelected ? "2px solid #2563eb" : "none",
                  background: "#fff",
                }}
              >
                <img
                  src={p.signedUrl || p.path}
                  alt={p.caption || `proof ${idx + 1}`}
                  draggable={false}
                  className="w-full h-full"
                  style={{ objectFit: p.objectFit || "cover", objectPosition: p.objectPosition || "center", pointerEvents: "none" }}
                />
                {isSelected && (
                  <>
                    {renderHandle(idx, "resize-nw", { left: -6, top: -6 })}
                    {renderHandle(idx, "resize-n",  { left: "calc(50% - 5px)", top: -6 })}
                    {renderHandle(idx, "resize-ne", { right: -6, top: -6 })}
                    {renderHandle(idx, "resize-e",  { right: -6, top: "calc(50% - 5px)" })}
                    {renderHandle(idx, "resize-se", { right: -6, bottom: -6 })}
                    {renderHandle(idx, "resize-s",  { left: "calc(50% - 5px)", bottom: -6 })}
                    {renderHandle(idx, "resize-sw", { left: -6, bottom: -6 })}
                    {renderHandle(idx, "resize-w",  { left: -6, top: "calc(50% - 5px)" })}
                  </>
                )}
                {/* Caption bar rendered ONLY when user has explicitly typed one — not
                    auto-populated from filename. Not shown on selected image so
                    handles remain visible. Not shown in editable mode by default. */}
                {!editable && p.caption && (
                  <div style={{ position: "absolute", left: 0, bottom: 0, right: 0, fontSize: 9, padding: "2px 4px", background: "rgba(255,255,255,0.85)" }}>{p.caption}</div>
                )}
              </div>
            );
          })
        : (
          <div className={`grid gap-1 w-full h-full p-1 ${photos.length === 1 ? "grid-cols-1" : photos.length === 2 ? "grid-cols-2" : photos.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
            {photos.map((p, idx) => (
              <img key={idx} src={p.signedUrl || p.path} alt={`Visual ${idx + 1}`} className="w-full h-full" style={{ objectFit: p.objectFit || "cover", objectPosition: p.objectPosition || "center" }} />
            ))}
          </div>
        )}
      {contextMenu && editable && (
        <div
          onMouseLeave={() => setContextMenu(null)}
          style={{
            position: "absolute",
            left: contextMenu.x,
            top: contextMenu.y,
            zIndex: 100,
            background: "#fff",
            border: "1px solid #cbd5e1",
            borderRadius: 6,
            boxShadow: "0 8px 16px rgba(0,0,0,0.15)",
            minWidth: 160,
            fontSize: 11,
            overflow: "hidden",
          }}
        >
          <button
            type="button"
            className="w-full text-left px-3 py-1.5 hover:bg-slate-100"
            onClick={() => { bringToFront(contextMenu.idx); setContextMenu(null); }}
          >Bring to Front</button>
          <button
            type="button"
            className="w-full text-left px-3 py-1.5 hover:bg-slate-100"
            onClick={() => { sendToBack(contextMenu.idx); setContextMenu(null); }}
          >Send to Back</button>
          <button
            type="button"
            className="w-full text-left px-3 py-1.5 hover:bg-red-50 text-red-600 font-bold border-t border-slate-100"
            onClick={() => { onDeletePhoto && onDeletePhoto(contextMenu.idx); setContextMenu(null); }}
          >Delete</button>
        </div>
      )}
    </div>
  );
};

function clamp(v: number, lo: number, hi: number) { return Math.min(hi, Math.max(lo, v)); }


type WccDcEditorProps = {
  [key: string]: any;
  clients: any[];
  brands: any[];
  stores: any[];
  estimates: any[];
  challans: any[];
  dcPhotos: any[];
  selectedEstimateItems: any[];
};

const WccDcEditor: React.FC<WccDcEditorProps> = (props) => {
  const {
    clients,
    brands,
    stores,
    wccChecklist,
    setDcPhotos,
    showDcModal,
    selectedEstimate,
    handleDcSubmit,
    setShowDcModal,
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
    handleRemovePhoto,
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
    activeWccsForEditor = [],
    navigateWccEditor,
    printAllWccs,
    wccPrintMode = "current",
    setWccPrintMode,
    token,
    sellerProfile = {},
    setDcDeliveredBy,
    setDcReceivedBy,
    setWccAuthPerson,
  } = props;

  // ── Bulk WCC → PDF export ─────────────────────────────────────────────
  // Reuses the same DOM the "Print All" flow already renders (wccPrintMode='all'
  // produces one `.wcc-print-page` per WCC). We swap to that mode, wait for
  // React + paint, then html2canvas each page → jsPDF → JSZip → single .zip
  // download. Filename per file: `<dcNumber> - <storeName>.pdf`. Dependencies
  // are dynamically imported so the initial bundle isn't inflated for users
  // who never trigger the export.
  const [isExportingAll, setIsExportingAll] = React.useState(false);
  const exportAllWccPdfs = async () => {
    if (isExportingAll) return;
    if (!activeWccsForEditor || activeWccsForEditor.length === 0) return;
    const originalMode = wccPrintMode;
    setIsExportingAll(true);
    try {
      if (setWccPrintMode) setWccPrintMode("all");
      // Two rAFs (React commit + browser paint) plus a short settle for image decode.
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      await new Promise<void>((r) => setTimeout(r, 400));

      const pages = Array.from(document.querySelectorAll<HTMLElement>(".wcc-print-page"));
      if (pages.length === 0) {
        alert("No WCCs available to export.");
        return;
      }

      const [{ default: html2canvas }, { default: jsPDF }, { default: JSZip }] = await Promise.all([
        import("html2canvas"),
        import("jspdf"),
        import("jszip"),
      ]);

      const zip = new JSZip();
      const usedNames = new Set<string>();
      const sanitize = (s: string) => s.replace(/[\\/:*?"<>|]+/g, "_").trim() || "Unnamed";
      for (let i = 0; i < pages.length; i++) {
        const el = pages[i];
        const dcNumber = sanitize(el.dataset.dcNumber || `WCC-${i + 1}`);
        const storeName = sanitize(el.dataset.storeName || "Unknown Store");
        let base = `${dcNumber} - ${storeName}`;
        let filename = `${base}.pdf`;
        let dup = 1;
        while (usedNames.has(filename)) filename = `${base} (${++dup}).pdf`;
        usedNames.add(filename);

        const canvas = await html2canvas(el, {
          scale: 2,
          useCORS: true,
          backgroundColor: "#ffffff",
          logging: false,
        });
        const imgData = canvas.toDataURL("image/jpeg", 0.92);
        // renderA4ChallanCanvas emits 210x297mm pages (A4 portrait).
        const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
        pdf.addImage(imgData, "JPEG", 0, 0, 210, 297);
        zip.file(filename, pdf.output("blob"));
      }

      const zipBlob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `WCCs-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Bulk WCC PDF export failed:", err);
      alert("Bulk PDF export failed. Check console for details.");
    } finally {
      if (setWccPrintMode) setWccPrintMode(originalMode);
      setIsExportingAll(false);
    }
  };

  // ── Editor-wide selection (single-photo) ──────────────────────────────
  // Lives at the modal level so keyboard shortcuts (Delete / Esc) can act on it.
  const [selectedPhotoIdx, setSelectedPhotoIdx] = React.useState<number | null>(null);
  React.useEffect(() => {
    // Reset selection when the list identity changes (e.g. store switch, load).
    setSelectedPhotoIdx(null);
  }, [editingDcId]);
  React.useEffect(() => {
    // Clamp selection if the array shrinks past it.
    if (selectedPhotoIdx !== null && selectedPhotoIdx >= (dcPhotos?.length || 0)) {
      setSelectedPhotoIdx(null);
    }
  }, [dcPhotos, selectedPhotoIdx]);

  // ── Modal-level keyboard + paste listeners ────────────────────────────
  // Attached to `document` while showDcModal is open so shortcuts work from
  // anywhere inside the modal (including when focus is on the left panel or
  // no element is focused at all).
  React.useEffect(() => {
    if (!showDcModal) return;
    const isEditableTarget = (t: EventTarget | null): boolean => {
      const el = t as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
    };
    const onKey = (e: KeyboardEvent) => {
      // Ctrl/Cmd+S = save (fires even inside inputs so the user never loses work)
      if ((e.metaKey || e.ctrlKey) && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        handleDcSubmit({ preventDefault: () => {} });
        return;
      }
      if (isEditableTarget(e.target)) return;
      if (e.key === "ArrowRight") {
        const cur = activeWccsForEditor.findIndex((dc: any) => dc.id === editingDcId);
        if (cur >= 0 && cur < activeWccsForEditor.length - 1 && navigateWccEditor) {
          e.preventDefault();
          navigateWccEditor(activeWccsForEditor[cur + 1].id);
        }
      } else if (e.key === "ArrowLeft") {
        const cur = activeWccsForEditor.findIndex((dc: any) => dc.id === editingDcId);
        if (cur > 0 && navigateWccEditor) {
          e.preventDefault();
          navigateWccEditor(activeWccsForEditor[cur - 1].id);
        }
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedPhotoIdx !== null) {
          e.preventDefault();
          handleRemovePhoto && handleRemovePhoto(selectedPhotoIdx);
          setSelectedPhotoIdx(null);
        }
      } else if (e.key === "Escape") {
        if (selectedPhotoIdx !== null) {
          e.preventDefault();
          setSelectedPhotoIdx(null);
        }
        // Otherwise fall through — the backdrop click handler still owns close.
      }
    };
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items || [];
      const files: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.kind === "file" && it.type.startsWith("image/")) {
          const f = it.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length > 0) {
        e.preventDefault();
        handleMultiPhotoUpload && handleMultiPhotoUpload(files);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("paste", onPaste);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("paste", onPaste);
    };
  }, [showDcModal, activeWccsForEditor, editingDcId, selectedPhotoIdx, navigateWccEditor, handleRemovePhoto, handleMultiPhotoUpload, handleDcSubmit]);

  const orderedSelectedStoreKeys = React.useMemo(
    () => orderedStoreKeysFromItems(selectedEstimateItems || [], selectedEstimate?.storeGrouping as Record<string, any>),
    [selectedEstimate, selectedEstimateItems],
  );
  const [bulkSelectedStoreIds, setBulkSelectedStoreIds] = React.useState<number[]>([]);
  const selectedStoreIdSet = React.useMemo(() => new Set(bulkSelectedStoreIds), [bulkSelectedStoreIds]);
  const selectableStores = React.useMemo(
    () => orderedSelectedStoreKeys
      .map((sid) => stores.find(s => s.id === Number(sid)))
      .filter(Boolean),
    [orderedSelectedStoreKeys, stores],
  );
  React.useEffect(() => {
    setBulkSelectedStoreIds((prev) => prev.filter((id) => selectableStores.some((s: any) => s.id === id)));
  }, [selectableStores]);

  const toggleBulkStore = (storeId: number) => {
    setBulkSelectedStoreIds((prev) => prev.includes(storeId) ? prev.filter(id => id !== storeId) : [...prev, storeId]);
  };
  const currentWccIndex = React.useMemo(
    () => activeWccsForEditor.findIndex((dc: any) => dc.id === editingDcId),
    [activeWccsForEditor, editingDcId],
  );
  const currentStoreTitle = React.useMemo(() => {
    const current = currentWccIndex >= 0 ? activeWccsForEditor[currentWccIndex] : null;
    if (!current) return "";
    return current.metadata?.storeName || stores.find(s => s.id === Number(current.metadata?.storeId || 0))?.name || "";
  }, [activeWccsForEditor, currentWccIndex, stores]);
  return (
    <>
      {(() => {
        // Dual-pane layout helper to render WCC/DC document perfectly
        const renderA4ChallanCanvas = (
          format: string,
          dcNumber: string,
          deliveryDate: string,
          deliveredBy: string,
          receivedBy: string,
          remarks: string,
          metadata: any,
          est: Estimate,
          items: any[]
        ) => {
          const targetClient = clients.find(c => c.id === est.clientId);
          const targetBrand = brands.find(b => b.id === est.brandId);
          // Honor an explicit metadata.storeId override (used by the WCC
          // builder when the user picks a per-store scope for an ABFRL
          // multi-store estimate), then fall back to the estimate's primary
          // storeId. Same applies to read-only preview when the saved DC
          // captured the storeId on its metadata.
          const scopedStoreId = metadata?.storeId
            ?? (metadata?.storeCode ? (stores.find(s => s.storeCode === metadata.storeCode)?.id) : undefined)
            ?? est.storeId;
          const targetStore = stores.find(s => s.id === scopedStoreId);
          const photosList = metadata?.photos || (metadata?.visualBrief ? [{ path: metadata.visualBrief, widthPct: 100, objectFit: 'cover', objectPosition: 'center center', caption: 'Storefront proof' }] : []);
          const authPersonVal = metadata?.authPerson || targetStore?.contactPerson || "";
          const shortageNotesVal = metadata?.shortageNotes || "";
          const storeCodeVal = metadata?.storeCode || targetStore?.storeCode || "LP-01";
          const companyName = sellerProfile.name || "Sunrise Media";
          const companyAddress = sellerProfile.address || "";
          const companyEmail = sellerProfile.email || "";
          const companyMobile = sellerProfile.mobile || "";
          const companyGstin = sellerProfile.gstin || "";
          const companyPan = sellerProfile.pan || "";
          const logoSrc = companyAssetUrl(sellerProfile.logoPath, token);
          const signatureStampSrc = companyAssetUrl(sellerProfile.signatureStampPath, token);
          // Bottom checklist persisted on dc.metadata.checklist. Falls back to
          // the live editor state when previewing an unsaved DC.
          const checklist = (metadata?.checklist as { window?: boolean; inStore?: boolean; nso?: boolean; repairing?: boolean; materialTransfer?: boolean } | undefined) || wccChecklist;

          const isWcc = isAblblFormat(format);

          if (isWcc) {
            // ==========================================
            // AUTHENTIC ABLBL WORK COMPLETION CERTIFICATE (WCC)
            //
            // Layout is rebuilt to match reference-docs/wcc/AKOLA_challan.pdf
            // (and the three Aundh / Black Vinyl variants). Structure:
            //   1. Thick black outer border around the entire A4 page
            //   2. Centered title row "WORK COMPLETION CERTIFICATE (Challan)"
            //   3. Vendor block (left) + DC/PO/Date table (right)
            //   4. "STORE NAME - X   Store code: Y" full-width row
            //   5. "PROJECT / JOB TITEL – Z" full-width row  (TITEL is intentional)
            //   6. "VISUAL BRIEF FOR EXECUTION (NON-COURIER)" header
            //   7. Large picture area (single composite/montage) + "PICTURE" label
            //   8. "DESCRIPTION" header + description input row
            //   9. Red centered "Below section need to filled by Store"
            //  10. Two-column store-only block:
            //        LEFT  = IF SHORTAGE/DAMAGE + Store grid (CODE/NAME/CITY/STATE)
            //        RIGHT = STORE SEAL AND SIGNATURE + NAME AND PHONE
            //  11. Five-row checklist legend with interactive checkboxes:
            //        WINDOW / IN STORE / NSO / REPAIRING SERVICES / MATERIAL TRANSFER
            // ==========================================
            const compositePhoto = photosList[0];
            const descriptionLine = (items?.[0]?.itemName ? `${items[0].itemName}` : (est.title || "")).toUpperCase();
            return (
              <div id="dc-print-canvas" className="w-[210mm] min-h-[297mm] bg-white text-black p-[10mm] shadow-2xl relative font-sans text-[11px] flex flex-col print:shadow-none print:m-0 print:p-0" style={{ border: "3px solid black", boxSizing: "border-box" }}>
                <style dangerouslySetInnerHTML={{ __html: `
                  @media print {
                    /* Kill the browser's default page margins so the WCC
                       fills the entire A4 sheet edge to edge. */
                    @page { size: A4 portrait; margin: 0; }
                    html, body { width: 210mm; height: 297mm; margin: 0 !important; padding: 0 !important; background: #fff !important; }
                    body * { visibility: hidden !important; }
                    body { width: 210mm !important; height: auto !important; min-height: 0 !important; margin: 0 !important; padding: 0 !important; overflow: visible !important; background: #fff !important; }
                    #root, .app-shell, .app-main, .app-main-scroll, .operations-print-root,
                    .wcc-modal-backdrop, .wcc-modal-panel, .wcc-print-shell {
                      display: contents !important;
                    }
                    .operations-print-root > :not(.wcc-modal-backdrop),
                    .wcc-modal-panel > :not(.wcc-print-shell),
                    .wcc-print-root > :not(#dc-print-canvas):not(.wcc-print-page) {
                      display: none !important;
                    }
                    .wcc-print-root, .wcc-print-root * { visibility: visible !important; }
                    .wcc-print-root {
                      display: block !important;
                      position: static !important;
                      width: 210mm !important;
                      height: auto !important;
                      padding: 0 !important;
                      margin: 0 !important;
                      overflow: visible !important;
                      background: #fff !important;
                    }
                    .wcc-print-page { page-break-after: always !important; break-after: page !important; width: 210mm !important; height: 297mm !important; overflow: hidden !important; }
                    .wcc-print-page:last-child { page-break-after: auto !important; break-after: auto !important; }
                    #dc-print-canvas {
                      position: relative !important;
                      left: auto !important; top: auto !important;
                      width: 210mm !important;
                      height: 297mm !important;
                      box-sizing: border-box !important;
                      background: white !important;
                      color: black !important;
                      padding: 6mm !important;
                      box-shadow: none !important;
                      margin: 0 !important;
                      border: 3pt solid black !important;
                      overflow: hidden !important;
                    }
                    /* Force background colours / borders to print */
                    #dc-print-canvas, #dc-print-canvas * {
                      -webkit-print-color-adjust: exact !important;
                      print-color-adjust: exact !important;
                    }
                  }
                  .wcc-cell { border: 1px solid black !important; padding: 4px 6px !important; vertical-align: top; }
                  .wcc-title { letter-spacing: 1px; }
                ` }} />

                {/* 2. TITLE */}
                <div className="text-center font-black text-[15px] py-2 wcc-title" style={{ borderBottom: "2px solid black" }}>
                  WORK COMPLETION CERTIFICATE (Challan)
                </div>

                {/* 3. Vendor block (left) + DC/PO/Date table (right) — no
                    empty rowSpan padding cell; rowSpan=3 keeps the vendor
                    block flush against the meta column. */}
                <table className="w-full border-collapse" style={{ borderLeft: "1px solid black", borderRight: "1px solid black" }}>
                  <tbody>
                    <tr>
                      <td className="wcc-cell w-[55%]" rowSpan={3}>
                        {logoSrc && (
                          <img
                            src={logoSrc}
                            alt={companyName}
                            className="h-8 w-auto max-w-[180px] object-contain mb-1"
                          />
                        )}
                        <div><b>Vendor Name:</b> {companyName}</div>
                        <div><b>Vendor Address &amp; GST:</b> {[companyAddress, companyGstin].filter(Boolean).join(" | ")}</div>
                        <div><b>Mail ID:</b> {companyEmail}</div>
                        <div><b>Contact No:</b> {companyMobile}</div>
                      </td>
                      <td className="wcc-cell w-[15%]"><b>DC No:</b></td>
                      <td className="wcc-cell w-[30%] font-bold">{dcNumber}</td>
                    </tr>
                    <tr>
                      <td className="wcc-cell"><b>PO No:</b></td>
                      <td className="wcc-cell font-bold">{est.poNumber || ""}</td>
                    </tr>
                    <tr>
                      <td className="wcc-cell"><b>Date:</b></td>
                      <td className="wcc-cell font-bold">{new Date((est as any)?.poDate || deliveryDate || Date.now()).toLocaleDateString('en-GB')}</td>
                    </tr>
                  </tbody>
                </table>

                {/* 4. STORE NAME / Store code */}
                <table className="w-full border-collapse">
                  <tbody>
                    <tr>
                      <td className="wcc-cell">
                        <b>STORE NAME -&nbsp;</b>{targetStore?.name || ""}
                        <span className="ml-8"><b>- Store code :</b> {storeCodeVal}</span>
                      </td>
                    </tr>
                    {/* 5. PROJECT / JOB TITEL — spelling preserved per reference */}
                    <tr>
                      <td className="wcc-cell"><b>PROJECT / JOB TITEL –</b> {(est.subject || est.title || "").toUpperCase()}</td>
                    </tr>
                  </tbody>
                </table>

                {/* 6. VISUAL BRIEF header */}
                <div className="text-center font-black py-1 wcc-title" style={{ borderLeft: "1px solid black", borderRight: "1px solid black", borderBottom: "1px solid black" }}>
                  VISUAL BRIEF FOR EXECUTION (NON-COURIER)
                </div>

                {/* 7. LARGE picture area — free-positioning canvas. Photos can be
                    dragged anywhere inside this frame and resized via the
                    bottom-right corner handle. On older WCCs without xPct/yPct,
                    photos fall back to a tile grid. Interactive editing is
                    disabled when this canvas is rendered inside the read-only
                    preview modal (no editable callback). */}
                <WccPictureArea
                  photos={photosList}
                  editable={!!metadata?.__editable}
                  onChange={(next) => { if (metadata?.__editable) setDcPhotos(next); }}
                  onFiles={handleMultiPhotoUpload}
                  selectedIdx={metadata?.__editable ? selectedPhotoIdx : null}
                  setSelectedIdx={metadata?.__editable ? setSelectedPhotoIdx : undefined}
                  onDeletePhoto={metadata?.__editable ? (idx) => { handleRemovePhoto && handleRemovePhoto(idx); setSelectedPhotoIdx(null); } : undefined}
                />
                <div className="text-center font-black py-0.5 wcc-title" style={{ borderLeft: "1px solid black", borderRight: "1px solid black", borderBottom: "1px solid black" }}>PICTURE</div>

                {/* 8. DESCRIPTION header + line */}
                <div className="text-center font-black py-0.5 wcc-title" style={{ borderLeft: "1px solid black", borderRight: "1px solid black", borderBottom: "1px solid black" }}>DESCRIPTION</div>
                <table className="w-full border-collapse">
                  <tbody>
                    <tr><td className="wcc-cell" style={{ minHeight: "8mm" }}>{descriptionLine}</td></tr>
                  </tbody>
                </table>

                {/* 9. Red "Below section…" banner */}
                <div className="text-center font-bold py-1" style={{ color: "#c20000", borderLeft: "1px solid black", borderRight: "1px solid black", borderBottom: "1px solid black" }}>
                  Below section need to filled by Store
                </div>

                {/* 10. Two-column store-only block */}
                <table className="w-full border-collapse">
                  <tbody>
                    <tr>
                      {/* LEFT: IF SHORTAGE/DAMAGE then small store grid */}
                      <td className="wcc-cell w-1/2" style={{ verticalAlign: "top" }}>
                        <div className="font-bold mb-1">IF SHORTAGE/DAMAGE, PLEASE DESCRIBE</div>
                        <div className="whitespace-pre-wrap text-[10px]" style={{ minHeight: "8mm" }}>{shortageNotesVal}</div>
                        <table className="w-full border-collapse mt-2 text-[10px]">
                          <tbody>
                            <tr><td className="wcc-cell font-bold w-1/2">STORE CODE</td><td className="wcc-cell">{storeCodeVal}</td></tr>
                            <tr><td className="wcc-cell font-bold">STORE NAME</td><td className="wcc-cell">{targetStore?.name || ""}</td></tr>
                            <tr><td className="wcc-cell font-bold">CITY</td><td className="wcc-cell">{targetStore?.city || ""}</td></tr>
                            <tr><td className="wcc-cell font-bold">STATE</td><td className="wcc-cell">{targetStore?.state || ""}</td></tr>
                          </tbody>
                        </table>
                      </td>
                      {/* RIGHT: STORE SEAL AND SIGNATURE + NAME AND PHONE NUMBER */}
                      <td className="wcc-cell w-1/2" style={{ verticalAlign: "top" }}>
                        <div className="font-bold mb-1">STORE SEAL AND SIGNATURE</div>
                        <div className="border border-dashed border-slate-400 h-[35mm] flex items-center justify-center text-slate-300 italic text-[10px]">
                          Affix store seal &amp; signature here
                        </div>
                        <div className="font-bold mt-3">NAME AND PHONE NUMBER OF AUTHORISED</div>
                        <div className="text-[10px] pt-1">{authPersonVal}</div>
                      </td>
                    </tr>
                  </tbody>
                </table>

                {/* 11. Bottom checklist — 5 rows of interactive checkboxes.
                    Print-stable: checkboxes are rendered as filled or empty
                    bordered squares regardless of @media. */}
                <table className="w-full border-collapse">
                  <tbody>
                    {[
                      { key: "window",           label: "WINDOW :- Adaptation picture + Window category + Window size", checked: !!checklist.window },
                      { key: "inStore",          label: "IN STORE :- Mannequin /Hanger / Easel/ POSM / VM hardware .", checked: !!checklist.inStore },
                      { key: "nso",              label: "NSO :- Signage adaptation/ negative area / in store branding", checked: !!checklist.nso },
                      { key: "repairing",        label: "REPAIRING SERVICES :- Before pictures + Description", checked: !!checklist.repairing },
                      { key: "materialTransfer", label: "MATERIAL TRANSFER :- Picture/ description", checked: !!checklist.materialTransfer },
                    ].map(row => (
                      <tr key={row.key}>
                        <td className="wcc-cell" style={{ width: "12mm", textAlign: "center" }}>
                          <span style={{
                            display: "inline-block",
                            width: "5mm",
                            height: "5mm",
                            border: "1.5px solid black",
                            background: row.checked ? "#16a34a" : "transparent",
                            color: "white",
                            lineHeight: "5mm",
                            textAlign: "center",
                            fontWeight: 900,
                            fontSize: "9px",
                          }}>{row.checked ? "✓" : ""}</span>
                        </td>
                        <td className="wcc-cell"><b>{row.label}</b></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          } else {
            // ==========================================
            // HIGH-FIDELITY STANDARD SUNRISE DELIVERY CHALLAN
            // ==========================================
            return (
              <div id="dc-print-canvas" className="w-[210mm] min-h-[297mm] bg-white text-slate-900 p-[15mm] border border-slate-800 shadow-2xl relative font-sans text-xs flex flex-col justify-between print:border-none print:shadow-none print:m-0 print:p-0" style={{ boxSizing: "border-box" }}>
                <style dangerouslySetInnerHTML={{ __html: `
                  @media print {
                    @page { size: A4 portrait; margin: 0; }
                    html, body { width: 210mm; height: 297mm; margin: 0 !important; padding: 0 !important; background: #fff !important; }
                    body * { visibility: hidden !important; }
                    body { width: 210mm !important; height: auto !important; min-height: 0 !important; margin: 0 !important; padding: 0 !important; overflow: visible !important; background: #fff !important; }
                    #root, .app-shell, .app-main, .app-main-scroll, .operations-print-root,
                    .wcc-modal-backdrop, .wcc-modal-panel, .wcc-print-shell {
                      display: contents !important;
                    }
                    .operations-print-root > :not(.wcc-modal-backdrop),
                    .wcc-modal-panel > :not(.wcc-print-shell),
                    .wcc-print-root > :not(#dc-print-canvas):not(.wcc-print-page) {
                      display: none !important;
                    }
                    .wcc-print-root, .wcc-print-root * { visibility: visible !important; }
                    .wcc-print-root {
                      display: block !important;
                      position: static !important;
                      width: 210mm !important;
                      height: auto !important;
                      padding: 0 !important;
                      margin: 0 !important;
                      overflow: visible !important;
                      background: #fff !important;
                    }
                    .wcc-print-page { page-break-after: always !important; break-after: page !important; width: 210mm !important; height: 297mm !important; overflow: hidden !important; }
                    .wcc-print-page:last-child { page-break-after: auto !important; break-after: auto !important; }
                    #dc-print-canvas {
                      position: relative !important;
                      left: auto !important;
                      top: auto !important;
                      width: 210mm !important;
                      height: 297mm !important;
                      box-sizing: border-box !important;
                      background: white !important;
                      color: black !important;
                      padding: 10mm !important;
                      box-shadow: none !important;
                      margin: 0 !important;
                      overflow: hidden !important;
                    }
                    #dc-print-canvas, #dc-print-canvas * {
                      -webkit-print-color-adjust: exact !important;
                      print-color-adjust: exact !important;
                    }
                  }
                  .dc-table th, .dc-table td {
                    border: 1px solid #1e293b !important;
                    padding: 5px 6px !important;
                  }
                `}} />

                <div className="space-y-5">
                  {/* Header */}
                  <div className="flex justify-between items-start border-b-2 border-slate-800 pb-3">
                    <div className="text-left">
                      {logoSrc ? (
                        <img
                          src={logoSrc}
                          alt={companyName}
                          className="h-11 w-auto max-w-[220px] object-contain mb-1"
                        />
                      ) : (
                        <h2 className="text-xl font-black text-slate-900 tracking-tight">{companyName.toUpperCase()}</h2>
                      )}
                      <p className="text-[8px] text-slate-500 font-mono mt-0.5">{[companyAddress, companyEmail, companyMobile].filter(Boolean).join(" | ")}</p>
                      <div className="text-[8px] text-slate-500 font-mono leading-tight max-w-[115mm]">
                        <div className="grid grid-cols-[12mm_1fr] gap-x-1">
                          <span className="font-bold">GSTIN:</span>
                          <span className="break-all">{companyGstin || "N/A"}</span>
                        </div>
                        <div className="grid grid-cols-[12mm_1fr] gap-x-1">
                          <span className="font-bold">PAN:</span>
                          <span className="break-all">{companyPan || "N/A"}</span>
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] font-black border border-slate-800 py-0.5 px-2 rounded uppercase tracking-wider font-sans inline-block bg-slate-50">
                        DELIVERY CHALLAN
                      </span>
                      <p className="text-xs font-mono font-bold text-slate-800 mt-1.5">No: {dcNumber}</p>
                      <p className="text-[8px] text-slate-500 font-mono mt-0.5">Date: {new Date((est as any)?.poDate || deliveryDate || Date.now()).toLocaleDateString('en-GB')}</p>
                    </div>
                  </div>

                  {/* Reference Grid */}
                  <table className="w-full dc-table border-collapse border border-slate-800 text-[9px]">
                    <tbody>
                      <tr className="bg-slate-50 font-semibold">
                        <td className="w-1/4">Estimate Ref:</td>
                        <td className="w-1/4 font-mono font-bold">{est.estimateNumber}</td>
                        <td className="w-1/4">PO Ref / Date:</td>
                        <td className="w-1/4 font-mono font-bold">{est.poNumber ? `${est.poNumber} (${est.poDate ? new Date(est.poDate).toLocaleDateString('en-GB') : ""})` : "N/A"}</td>
                      </tr>
                      <tr>
                        <td>Delivered Via:</td>
                        <td>{deliveredBy || "Sunrise vehicle"}</td>
                        <td>Client Profile:</td>
                        <td className="uppercase">{format}</td>
                      </tr>
                    </tbody>
                  </table>

                  {/* Addresses */}
                  <div className="grid grid-cols-2 gap-4 text-[9px]">
                    <div className="border border-slate-800 p-2.5 space-y-1 bg-white">
                      <span className="text-[7.5px] uppercase block font-black text-slate-400 tracking-wider">Client Billing Details</span>
                      <p className="font-extrabold text-slate-800 text-[10px]">{est.billingLegalNameSnapshot || est.billingTo || targetClient?.name}</p>
                      <p className="text-slate-650 leading-relaxed whitespace-pre-wrap">{est.billingAddressSnapshot || est.billingTo || targetClient?.address || "N/A"}</p>
                      <div className="pt-1.5 border-t border-slate-200 mt-1.5 font-mono text-[8px] text-slate-500 space-y-0.5">
                        <div><strong>GSTIN:</strong> {est.billingGstinSnapshot || est.gstin || targetClient?.gstNumber || "N/A"}</div>
                        <div><strong>PAN:</strong> {est.pan || targetClient?.pan || "N/A"}</div>
                        <div><strong>State / Code:</strong> {est.billingStateSnapshot || "N/A"} ({est.billingStateCodeSnapshot || est.stateCode || "N/A"})</div>
                      </div>
                    </div>
                    <div className="border border-slate-800 p-2.5 space-y-1 bg-white">
                      <span className="text-[7.5px] uppercase block font-black text-slate-400 tracking-wider">Delivery Site / Consignee</span>
                      <p className="font-extrabold text-slate-800 text-[10px]">{targetStore?.name || "Default Site"} {storeCodeVal ? `(${storeCodeVal})` : ""}</p>
                      <p className="text-slate-650 leading-relaxed whitespace-pre-wrap">{targetStore?.address || "N/A"}</p>
                      <div className="pt-1.5 border-t border-slate-200 mt-1.5 font-mono text-[8px] text-slate-500 space-y-0.5">
                        <div><strong>City / Zone:</strong> {targetStore?.city || "N/A"} / {targetStore?.regionZone || "N/A"}</div>
                        <div><strong>State / Code:</strong> {targetStore?.state || "N/A"} ({targetStore?.stateCode || "N/A"})</div>
                        <div><strong>Contact Name:</strong> {receivedBy || targetStore?.contactPerson || "Store Manager"}</div>
                      </div>
                    </div>
                  </div>

                  {/* Items list */}
                  <table className="w-full dc-table border-collapse border border-slate-800 text-[9px]">
                    <thead className="bg-slate-50 font-bold text-center">
                      <tr>
                        <th className="w-8">Sl.</th>
                        <th>Element / Product Details</th>
                        <th className="w-24">Specs (W x H)</th>
                        <th className="w-16">Quantity</th>
                        <th className="w-16">Unit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item, idx) => (
                        <tr key={idx}>
                          <td className="text-center font-mono">{idx + 1}</td>
                          <td>
                            <p className="font-bold text-slate-800">{item.itemName}</p>
                            {item.description && <p className="text-[8px] text-slate-500 font-sans leading-tight mt-0.5">{item.description}</p>}
                          </td>
                          <td className="text-center font-mono">
                            {item.width && item.height ? `${item.width}" × ${item.height}"` : "-"}
                          </td>
                          <td className="text-center font-mono font-bold">{item.quantity}</td>
                          <td className="text-center uppercase">{item.unit || "sqft"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {/* Photos proof layout (for simple DC showing thumbnails) */}
                  {photosList.length > 0 && (
                    <div className="space-y-2 border border-slate-850 p-2.5 rounded bg-slate-50/20">
                      <span className="text-[8px] uppercase block font-black text-slate-450 tracking-wider">Installation Proof Attachments</span>
                      <div className="grid grid-cols-2 gap-3">
                        {photosList.map((photo: any, index: number) => (
                          <div key={index} className="border border-slate-200 rounded overflow-hidden bg-white p-1 flex gap-2">
                            <img
                              src={photo.signedUrl || photo.path}
                              alt={`Proof ${index + 1}`}
                              className="w-12 h-12 object-cover rounded border border-slate-100 flex-shrink-0"
                            />
                            <div className="text-[8px] space-y-0.5 truncate flex-1 justify-center flex flex-col">
                              <div className="font-bold text-slate-800 truncate">Proof Image #{index + 1}</div>
                              {photo.caption && <div className="text-slate-500 italic truncate">{photo.caption}</div>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Remarks & terms */}
                  <div className="grid grid-cols-2 gap-4 text-[9px] pt-1">
                    <div className="space-y-1">
                      <span className="font-bold block uppercase text-slate-500 text-[8px]">Terms and Declarations:</span>
                      <ol className="list-decimal pl-3 space-y-0.5 text-slate-500 text-[8px] leading-tight">
                        <li>Materials received in good and satisfactory condition.</li>
                        <li>Mountings are subject to client verification on site.</li>
                        <li>This is a commercial dispatch document, not a tax invoice.</li>
                      </ol>
                    </div>
                    {remarks && (
                      <div className="border-l border-slate-300 pl-3 italic text-slate-600 self-center">
                        <strong>Dispatch Notes:</strong> {remarks}
                      </div>
                    )}
                  </div>
                </div>

                {/* Footer / Signatories */}
                <div className="grid grid-cols-2 gap-12 pt-8 border-t border-slate-800 mt-8 text-[9px] font-sans text-slate-600">
                  <div className="space-y-10">
                    <p className="font-bold text-left">Received above goods in perfect condition</p>
                    <div className="pt-1.5 border-t border-dashed border-slate-450 font-bold text-slate-800 text-left">
                      Customer Seal & Signature (Date: ____________)
                    </div>
                  </div>
                  <div className="space-y-10 text-right">
                    <p className="font-bold">For {companyName.toUpperCase()}</p>
                    <div className="h-[22mm] flex items-center justify-end">
                      {signatureStampSrc && (
                        <img
                          src={signatureStampSrc}
                          alt="Signature and stamp"
                          className="max-h-[20mm] max-w-[48mm] object-contain"
                        />
                      )}
                    </div>
                    <div className="pt-1.5 border-t border-dashed border-slate-450 font-bold text-slate-800">
                      Authorized Signatory (Sign & Stamp)
                    </div>
                  </div>
                </div>
              </div>
            );
          }
        };

        return (
          <>
            {/* 1. CREATION / EDITING CANVAS MODAL */}
            {showDcModal && selectedEstimate && (
              <div className="wcc-modal-backdrop fixed inset-0 z-[150] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 print:p-0" onClick={() => setShowDcModal(false)}>
                <div className="wcc-modal-panel bg-slate-100 w-full max-w-7xl h-[95vh] rounded-2xl shadow-2xl border border-slate-200 flex flex-col md:flex-row overflow-hidden print:w-screen print:h-screen print:rounded-none print:border-none print:shadow-none" onClick={(event) => event.stopPropagation()}>
                  
                  {/* Left Controls Panel — simplified, PowerPoint-style. Anything
                      that used to live here but is now considered secondary
                      metadata (format picker, Delivered By, Received By, Auth
                      person) has moved to the compact top header inside the
                      right panel. The canvas owns all image manipulation. */}
                  <form onSubmit={handleDcSubmit} className="w-full md:w-[280px] bg-white p-5 border-r border-slate-200 overflow-y-auto space-y-5 flex flex-col justify-between print:hidden">
                    <div className="space-y-5">
                      <div className="border-b border-slate-200 pb-3 flex justify-between items-start">
                        <div>
                          <span className="text-[10px] font-black text-orange-600 uppercase tracking-widest block">Execution</span>
                          <h4 className="font-extrabold text-slate-800 text-base">WCC Builder</h4>
                        </div>
                        <button type="button" onClick={() => setShowDcModal(false)} className="text-slate-400 hover:text-slate-600 p-1.5 hover:bg-slate-100 rounded-full transition">
                          <X className="w-5 h-5" />
                        </button>
                      </div>

                      <div className="space-y-4 text-xs">
                        {/* 1. Document number — readonly badge (dc-save generates it) */}
                        <div>
                          <label className="block font-bold text-slate-500 uppercase mb-1 text-[10px]">Document Number</label>
                          <div className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 font-bold font-mono text-sm">
                            {dcNumberVal || <span className="text-slate-400 italic font-normal text-xs">Auto-generated on save</span>}
                          </div>
                        </div>

                        {/* 2. Store selector (for ABFRL multi-store estimates) */}
                        {dcFormat === "ABFRL" && orderedSelectedStoreKeys.length > 0 && (
                          <div>
                            <label className="block font-bold text-slate-500 uppercase mb-1 text-[10px]">Store</label>
                            <select
                              value={dcWccStoreScope}
                              onChange={(e) => setDcWccStoreScope(e.target.value)}
                              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-purple-500 text-xs font-bold"
                            >
                              <option value="">(estimate primary store)</option>
                              {orderedSelectedStoreKeys.map(sid => {
                                const tStore = stores.find(s => s.id === Number(sid));
                                return <option key={sid} value={sid}>{tStore?.storeCode ? `${tStore.storeCode} — ` : ""}{tStore?.name || `Store ${sid}`}</option>;
                              })}
                            </select>
                          </div>
                        )}

                        {/* 3. Prev / Next store buttons (arrow keys also work) */}
                        {activeWccsForEditor.length > 1 && (
                          <div className="space-y-1.5">
                            <div className="text-[10px] font-bold text-slate-500 uppercase flex justify-between">
                              <span>Navigate</span>
                              {currentWccIndex >= 0 && (
                                <span className="font-mono text-slate-400">{currentWccIndex + 1} / {activeWccsForEditor.length}</span>
                              )}
                            </div>
                            <div className="flex gap-1.5">
                              <button
                                type="button"
                                disabled={currentWccIndex <= 0}
                                onClick={() => navigateWccEditor && navigateWccEditor(activeWccsForEditor[currentWccIndex - 1].id)}
                                className="flex-1 px-2 py-1.5 text-[11px] font-bold rounded border border-slate-200 disabled:opacity-40 hover:bg-slate-50"
                                title="← Prev store"
                              >← Prev</button>
                              <button
                                type="button"
                                disabled={currentWccIndex >= activeWccsForEditor.length - 1}
                                onClick={() => navigateWccEditor && navigateWccEditor(activeWccsForEditor[currentWccIndex + 1].id)}
                                className="flex-1 px-2 py-1.5 text-[11px] font-bold rounded border border-slate-200 disabled:opacity-40 hover:bg-slate-50"
                                title="Next store →"
                              >Next →</button>
                            </div>
                            {currentStoreTitle && <div className="text-[11px] font-bold text-slate-800 truncate">{currentStoreTitle}</div>}
                          </div>
                        )}

                        {/* 4 + 5. Bulk actions — visible only for multi-store ABFRL estimates */}
                        {dcFormat === "ABFRL" && orderedSelectedStoreKeys.length >= 2 && (
                          <div className="space-y-2 pt-3 border-t border-slate-100">
                            <button
                              type="button"
                              onClick={() => { handleBatchGenerateWcc(); setShowDcModal(false); }}
                              disabled={activeWccsForEditor.length >= orderedSelectedStoreKeys.length}
                              className="w-full py-2 px-3 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[11px] font-bold rounded-lg transition shadow-sm"
                              title={activeWccsForEditor.length >= orderedSelectedStoreKeys.length ? "Already generated" : ""}
                            >
                              Generate All ({orderedSelectedStoreKeys.length} WCCs)
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                if (dcPhotos.length === 0) { alert("Add photos first."); return; }
                                const remaining = Math.max(0, activeWccsForEditor.length - 1);
                                if (remaining === 0) { alert("No other stores to apply to."); return; }
                                if (!confirm(`Apply these ${dcPhotos.length} image${dcPhotos.length === 1 ? "" : "s"} to ${remaining} remaining store${remaining === 1 ? "" : "s"}?`)) return;
                                handleApplyCurrentPhotosToAllWccs();
                              }}
                              disabled={dcPhotos.length === 0}
                              className="w-full py-2 px-3 bg-white hover:bg-purple-50 disabled:opacity-40 border border-purple-200 text-purple-700 text-[11px] font-bold rounded-lg transition flex items-center justify-center gap-1.5"
                            >
                              <Copy className="w-3.5 h-3.5" />
                              Apply Current Images To All
                            </button>
                          </div>
                        )}

                        {/* 6. Checklist (ABFRL only) */}
                        {dcFormat === "ABFRL" && (
                          <div className="pt-3 border-t border-slate-100">
                            <label className="block font-bold text-slate-500 uppercase mb-2 text-[10px]">Job Category</label>
                            <div className="space-y-1.5 text-[11px]">
                              {([
                                { key: "window",           label: "Window" },
                                { key: "inStore",          label: "In-Store" },
                                { key: "nso",              label: "NSO" },
                                { key: "repairing",        label: "Repairing Services" },
                                { key: "materialTransfer", label: "Material Transfer" },
                              ] as const).map(row => (
                                <label key={row.key} className="flex items-center gap-2 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={!!wccChecklist[row.key]}
                                    onChange={(e) => setWccChecklist({ ...wccChecklist, [row.key]: e.target.checked })}
                                    className="accent-purple-600"
                                  />
                                  <span className="text-slate-700">{row.label}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Shortage notes (ABFRL only) */}
                        {dcFormat === "ABFRL" && (
                          <div>
                            <label className="block font-bold text-slate-500 uppercase mb-1 text-[10px]">Shortage / Damage Notes</label>
                            <textarea
                              rows={2}
                              value={wccShortageNotes}
                              onChange={(e) => setWccShortageNotes(e.target.value)}
                              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none resize-none font-sans text-xs"
                              placeholder="'None' if perfectly mounted."
                            />
                          </div>
                        )}

                        {/* 7. Notes / dispatch remarks */}
                        <div>
                          <label className="block font-bold text-slate-500 uppercase mb-1 text-[10px]">Notes</label>
                          <textarea
                            rows={2}
                            value={dcRemarks}
                            onChange={(e) => setDcRemarks(e.target.value)}
                            className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none resize-none font-sans text-xs"
                            placeholder="General remarks…"
                          />
                        </div>

                        <p className="text-[10px] text-slate-400 leading-snug pt-1 border-t border-slate-100">
                          <b>Shortcuts:</b> ← → navigate · Del delete image · Esc deselect · ⌘/Ctrl+V paste · ⌘/Ctrl+S save · Shift+drag = free resize.
                        </p>
                      </div>
                    </div>

                    <div className="flex gap-2 pt-4 border-t border-slate-100 bg-white print:hidden">
                      <button
                        type="button"
                        onClick={() => { setWccPrintMode && setWccPrintMode("current"); window.print(); }}
                        className="flex-1 h-9 px-3 border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium rounded-lg transition-all flex items-center justify-center gap-1.5"
                      >
                        <Printer className="w-4 h-4 text-slate-400" />
                        Print
                      </button>
                      {activeWccsForEditor.length > 1 && (
                        <button
                          type="button"
                          onClick={printAllWccs}
                          className="flex-1 h-9 px-3 border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium rounded-lg transition-all flex items-center justify-center gap-1.5"
                        >
                          <Printer className="w-4 h-4 text-slate-400" />
                          Print All
                        </button>
                      )}
                      {activeWccsForEditor.length > 1 && (
                        <button
                          type="button"
                          onClick={exportAllWccPdfs}
                          disabled={isExportingAll}
                          title="Download every WCC as a separate PDF (packaged as one ZIP)"
                          className="flex-1 h-9 px-3 border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 text-xs font-medium rounded-lg transition-all flex items-center justify-center gap-1.5"
                        >
                          <Download className="w-4 h-4 text-slate-400" />
                          {isExportingAll ? `Exporting ${activeWccsForEditor.length}…` : "Export All PDFs"}
                        </button>
                      )}
                      <button
                        type="submit"
                        className="flex-1 h-9 px-3 bg-orange-600 hover:bg-orange-700 text-white text-xs font-semibold rounded-lg transition-all shadow-sm"
                      >
                        Save
                      </button>
                    </div>
                  </form>

                  {/* Right Live Canvas (A4 Page View) */}
                  <div className="flex-1 flex flex-col overflow-hidden">
                    {/* Compact top header — dcFormat picker + secondary metadata + Add Photos.
                        Hidden in print. Kept intentionally small so the A4 canvas dominates. */}
                    <div className="bg-white border-b border-slate-200 px-4 py-2 flex flex-wrap items-center gap-2 print:hidden">
                      <select
                        value={dcFormat}
                        onChange={(e) => setDcFormat(e.target.value)}
                        className="px-2 py-1 bg-white border border-slate-200 rounded text-[11px] font-bold text-slate-700 focus:outline-none focus:border-orange-500"
                      >
                        <option value="normal">DC · Standard</option>
                        <option value="ABFRL">WCC · ABLBL</option>
                      </select>
                      <input
                        type="text"
                        value={dcDeliveredBy || ""}
                        onChange={(e) => setDcDeliveredBy && setDcDeliveredBy(e.target.value)}
                        placeholder="Delivered by"
                        className="px-2 py-1 bg-white border border-slate-200 rounded text-[11px] w-36 focus:outline-none focus:border-orange-500"
                      />
                      <input
                        type="text"
                        value={dcReceivedBy || ""}
                        onChange={(e) => setDcReceivedBy && setDcReceivedBy(e.target.value)}
                        placeholder="Received by"
                        className="px-2 py-1 bg-white border border-slate-200 rounded text-[11px] w-36 focus:outline-none focus:border-orange-500"
                      />
                      {dcFormat === "ABFRL" && (
                        <input
                          type="text"
                          value={props.wccAuthPerson || ""}
                          onChange={(e) => setWccAuthPerson && setWccAuthPerson(e.target.value)}
                          placeholder="Auth person (name + phone)"
                          className="px-2 py-1 bg-white border border-slate-200 rounded text-[11px] w-52 focus:outline-none focus:border-purple-500"
                        />
                      )}
                      <div className="ml-auto flex items-center gap-2">
                        <label className="flex items-center gap-1 py-1 px-2 bg-orange-600 hover:bg-orange-500 text-white text-[11px] font-bold rounded cursor-pointer transition">
                          <Plus className="w-3 h-3" />
                          Add Photos
                          <input
                            type="file"
                            accept="image/*"
                            multiple
                            className="hidden"
                            onChange={(e) => { handleMultiPhotoUpload(e.target.files); e.target.value = ""; }}
                          />
                        </label>
                      </div>
                    </div>
                    <div className="wcc-print-shell flex-1 bg-white p-6 overflow-y-auto flex items-start justify-center print:bg-white print:p-0 print:overflow-visible" data-print-document="true">
                      <div className="wcc-print-root">
                    {wccPrintMode === "all" && activeWccsForEditor.length > 0
                      ? activeWccsForEditor.map((dc: any) => {
                          const linkedEst = estimates.find((e: any) => e.id === dc.estimateId) || selectedEstimate;
                          if (!linkedEst) return null;
                          const dcItemsList = Array.isArray(dc.items) ? dc.items : [];
                          return (
                            <div
                              key={dc.id}
                              className="wcc-print-page"
                              data-dc-number={dc.dcNumber || ""}
                              data-store-name={dc.metadata?.storeName || ""}
                            >
                              {renderA4ChallanCanvas(
                                dc.clientFormat,
                                dc.dcNumber,
                                dc.deliveryDate,
                                dc.deliveredBy || "",
                                dc.receivedBy || "",
                                dc.remarks || "",
                                dc.metadata,
                                linkedEst,
                                dcItemsList
                              )}
                            </div>
                          );
                        })
                      : renderA4ChallanCanvas(
                          dcFormat,
                          dcNumberVal,
                          new Date().toISOString(),
                          dcDeliveredBy,
                          dcReceivedBy,
                          dcRemarks,
                          {
                            photos: dcPhotos,
                            authPerson: wccAuthPerson,
                            shortageNotes: wccShortageNotes,
                            checklist: wccChecklist,
                            storeId: dcWccStoreScope ? Number(dcWccStoreScope) : undefined,
                            __editable: true,
                          },
                          selectedEstimate,
                          selectedEstimateItems
                        )}
                      </div>
                    </div>
                  </div>

                </div>
              </div>
            )}

            {/* 2. READ-ONLY PREVIEW & PRINT MODAL FOR EXISTING DC */}
            {showDcPreviewModal && selectedDcForPreview && (() => {
              const linkedEst = estimates.find(e => e.id === selectedDcForPreview.estimateId);
              if (!linkedEst) return null;

              const dcItemsList = Array.isArray(selectedDcForPreview.items)
                ? selectedDcForPreview.items
                : [];

              // For multi-store ABFRL estimates, group all WCCs that share the
              // same estimate id so the user can step prev/next through them.
              const siblingDcs = challans
                .filter(c => c.estimateId === selectedDcForPreview.estimateId)
                .filter(c => c.status !== "deleted" && !c.metadata?.deleted)
                .sort((a, b) => (a.id || 0) - (b.id || 0));
              const curIdx = siblingDcs.findIndex(c => c.id === selectedDcForPreview.id);
              const prevDc = curIdx > 0 ? siblingDcs[curIdx - 1] : null;
              const nextDc = curIdx >= 0 && curIdx < siblingDcs.length - 1 ? siblingDcs[curIdx + 1] : null;

              return (
                <div className="wcc-modal-backdrop fixed inset-0 z-[150] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 print:p-0" onClick={() => { setShowDcPreviewModal(false); setSelectedDcForPreview(null); }}>
                  <div className="wcc-modal-panel bg-slate-100 w-full max-w-5xl h-[95vh] rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden print:w-screen print:h-screen print:rounded-none print:border-none print:shadow-none" onClick={(event) => event.stopPropagation()}>

                    {/* Header bar (Not printed) */}
                    <div className="bg-white px-6 py-4 border-b border-slate-200 flex justify-between items-center print:hidden shadow-sm">
                      <div className="flex items-center gap-3">
                        <div>
                          <h3 className="font-black text-slate-800 text-lg">Document View / Export Canvas</h3>
                          <p className="text-xs text-slate-400">Previewing <span className="font-bold text-orange-600">{selectedDcForPreview.dcNumber}</span>{siblingDcs.length > 1 ? ` — ${curIdx + 1} of ${siblingDcs.length} stores` : ""}</p>
                        </div>
                        {siblingDcs.length > 1 && (
                          <div className="flex items-center gap-1 ml-3">
                            <button
                              onClick={() => prevDc && setSelectedDcForPreview(prevDc)}
                              disabled={!prevDc}
                              className="inline-flex items-center gap-1 py-1.5 px-3 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 text-slate-700 text-xs font-bold rounded-lg transition"
                            >
                              ← Prev store
                            </button>
                            <button
                              onClick={() => nextDc && setSelectedDcForPreview(nextDc)}
                              disabled={!nextDc}
                              className="inline-flex items-center gap-1 py-1.5 px-3 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 text-slate-700 text-xs font-bold rounded-lg transition"
                            >
                              Next store →
                            </button>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => { setWccPrintMode && setWccPrintMode("current"); window.print(); }}
                          className="inline-flex items-center gap-1.5 py-2 px-4 bg-orange-600 hover:bg-orange-500 text-white text-xs font-bold rounded-lg transition shadow-md"
                        >
                          <Printer className="w-4 h-4" />
                          Print Current Store
                        </button>
                        {siblingDcs.length > 1 && (
                          <button
                            onClick={() => { setWccPrintMode && setWccPrintMode("all"); window.setTimeout(() => window.print(), 100); }}
                            className="inline-flex items-center gap-1.5 py-2 px-4 bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold rounded-lg transition shadow-md"
                          >
                            <Printer className="w-4 h-4" />
                            Print All WCCs
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setShowDcPreviewModal(false);
                            setSelectedDcForPreview(null);
                          }}
                          className="text-slate-400 hover:text-slate-700 p-2 hover:bg-slate-100 rounded-full transition"
                        >
                          <X className="w-5 h-5" />
                        </button>
                      </div>
                    </div>

                    {/* Proportional canvas viewer */}
                    <div className="wcc-print-shell flex-1 bg-white p-8 overflow-y-auto flex items-start justify-center print:bg-white print:p-0 print:overflow-visible" data-print-document="true">
                      <div className="wcc-print-root">
                      {wccPrintMode === "all" && siblingDcs.length > 0
                        ? siblingDcs.map((dc: any) => {
                            const est = estimates.find((e: any) => e.id === dc.estimateId) || linkedEst;
                            return (
                              <div
                                key={dc.id}
                                className="wcc-print-page"
                                data-dc-number={dc.dcNumber || ""}
                                data-store-name={dc.metadata?.storeName || ""}
                              >
                                {renderA4ChallanCanvas(
                                  dc.clientFormat,
                                  dc.dcNumber,
                                  dc.deliveryDate,
                                  dc.deliveredBy || "",
                                  dc.receivedBy || "",
                                  dc.remarks || "",
                                  dc.metadata,
                                  est,
                                  Array.isArray(dc.items) ? dc.items : []
                                )}
                              </div>
                            );
                          })
                        : (
                          <div className="wcc-print-page">
                            {renderA4ChallanCanvas(
                              selectedDcForPreview.clientFormat,
                              selectedDcForPreview.dcNumber,
                              selectedDcForPreview.deliveryDate,
                              selectedDcForPreview.deliveredBy || "",
                              selectedDcForPreview.receivedBy || "",
                              selectedDcForPreview.remarks || "",
                              selectedDcForPreview.metadata,
                              linkedEst,
                              dcItemsList
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                  </div>
                </div>
              );
            })()}
          </>
        );
      })()}
    </>
  );
};

export default WccDcEditor;
