import { useState, useEffect, useRef } from "react";
import type { DeliveryChallan, WccPhoto } from "../types";

export const useWccDcEditor = () => {
  const [showDcModal, setShowDcModal] = useState(false);
  const [dcNumberVal, setDcNumberVal] = useState("");
  const [dcDeliveredBy, setDcDeliveredBy] = useState("");
  const [dcReceivedBy, setDcReceivedBy] = useState("");
  const [dcRemarks, setDcRemarks] = useState("");
  const [wccVisualBrief, setWccVisualBrief] = useState("");
  const [wccShortageNotes, setWccShortageNotes] = useState("");
  const [wccAuthPerson, setWccAuthPerson] = useState("");
  const [wccChecklist, setWccChecklist] = useState({
    window: true,
    inStore: false,
    nso: false,
    repairing: false,
    materialTransfer: false,
  });
  const [dcPhotos, setDcPhotos] = useState<WccPhoto[]>([]);
  const [dcFormat, setDcFormat] = useState<string>("normal");
  const [selectedDcForPreview, setSelectedDcForPreview] = useState<DeliveryChallan | null>(null);
  const [showDcPreviewModal, setShowDcPreviewModal] = useState(false);
  const [dcWccStoreScope, setDcWccStoreScope] = useState<string>("");
  const [editingDcId, setEditingDcId] = useState<number | null>(null);
  const [wccPrintMode, setWccPrintMode] = useState<"current" | "all">("current");

  // ── Dirty tracking (auto-save on store switch) ────────────────────────────
  // `isWccDirty` becomes true when any user-editable WCC field changes after
  // the record was loaded. `markWccPristine()` is called by openDcForEdit()
  // (after it hydrates state) and by handleDcSubmit() on successful save.
  // The suppressRef flag consumes the effect fire that comes from those bulk
  // hydrations so we don't mis-classify a load as an edit.
  const [isWccDirty, setIsWccDirty] = useState(false);
  const suppressDirtyRef = useRef(false);

  useEffect(() => {
    if (suppressDirtyRef.current) {
      suppressDirtyRef.current = false;
      return;
    }
    setIsWccDirty(true);
  }, [
    dcPhotos,
    dcRemarks,
    wccChecklist,
    wccShortageNotes,
    wccAuthPerson,
    dcNumberVal,
    dcDeliveredBy,
    dcReceivedBy,
    wccVisualBrief,
    dcWccStoreScope,
    dcFormat,
  ]);

  const markWccPristine = () => {
    suppressDirtyRef.current = true;
    setIsWccDirty(false);
  };

  return {
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
    isWccDirty,
    markWccPristine,
  };
};
