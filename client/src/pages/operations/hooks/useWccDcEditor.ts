import { useState } from "react";
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
  };
};
