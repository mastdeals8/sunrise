import React, { useCallback, useRef, useState } from "react";
import { X, Upload, FileUp, ClipboardPaste } from "lucide-react";

interface PoUploadModalProps {
  handlePoSubmit: (e: React.FormEvent) => void;
  setShowPoModal: (v: boolean) => void;
  poNumber: string;
  setPoNumber: (v: string) => void;
  poDate: string;
  setPoDate: (v: string) => void;
  poAmount: string;
  setPoAmount: (v: string) => void;
  poAmountType: "without_gst" | "with_gst";
  setPoAmountType: (v: "without_gst" | "with_gst") => void;
  poBaseAmount: number;
  poWithGstAmount: number;
  poFileUrl: string;
  setPoFileUrl: (v: string) => void;
  poRemarks: string;
  setPoRemarks: (v: string) => void;
  uploadingPo: boolean;
  handleFileUpload: (
    e: React.ChangeEvent<HTMLInputElement>,
    docType: string,
    setUrl: (path: string) => void
  ) => void;
}

const PoUploadModal: React.FC<PoUploadModalProps> = ({
  handlePoSubmit,
  setShowPoModal,
  poNumber,
  setPoNumber,
  poDate,
  setPoDate,
  poAmount,
  setPoAmount,
  poAmountType,
  setPoAmountType,
  poBaseAmount,
  poWithGstAmount,
  poFileUrl,
  setPoFileUrl,
  poRemarks,
  setPoRemarks,
  uploadingPo,
  handleFileUpload,
}) => {
  const isReplacing = Boolean(poFileUrl || poNumber);
  const fileName = poFileUrl ? poFileUrl.split("/").pop() : "";
  const [isDragging, setIsDragging] = useState(false);
  const [dragError, setDragError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const triggerFileInput = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const uploadFile = useCallback(
    (file: File) => {
      setDragError("");
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      const fileList = dataTransfer.files;
      const syntheticEvent = {
        target: { files: fileList, value: file.name },
        currentTarget: { files: fileList, value: file.name },
      } as unknown as React.ChangeEvent<HTMLInputElement>;
      handleFileUpload(syntheticEvent, "client_po", setPoFileUrl);
    },
    [handleFileUpload, setPoFileUrl]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      setDragError("");
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;
      uploadFile(files[0]);
    },
    [uploadFile]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].kind === "file") {
          const file = items[i].getAsFile();
          if (file) {
            e.preventDefault();
            uploadFile(file);
            return;
          }
        }
      }
    },
    [uploadFile]
  );

  return (
    <div data-qa="po-upload-modal" className="fixed inset-0 z-[100] bg-slate-900/60 flex items-center justify-center p-4">
      <form
        onSubmit={handlePoSubmit}
        onPaste={handlePaste}
        className="bg-white w-full max-w-lg rounded-lg shadow-2xl border border-slate-200 overflow-hidden"
      >
        <div className="px-4 py-3 bg-slate-900 text-white flex justify-between items-center">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-orange-400">Purchase Order</p>
            <h4 className="font-bold text-sm">{isReplacing ? "View / Replace PO" : "Attach Client PO"}</h4>
          </div>
          <button type="button" onClick={() => setShowPoModal(false)} className="p-1 text-slate-300 hover:text-white hover:bg-white/10 rounded"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-4 space-y-3 text-xs">
          <div>
            <label className="block font-bold text-slate-500 uppercase mb-1">Purchase Order (PO) Number</label>
            <input
              type="text"
              required
              value={poNumber}
              onChange={(e) => setPoNumber(e.target.value)}
              className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded text-slate-800 focus:outline-none focus:border-orange-500 font-bold"
              placeholder="e.g. PO/ABFRL/2026/001"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block font-bold text-slate-500 uppercase mb-1">PO Date</label>
              <input
                type="date"
                required
                value={poDate}
                onChange={(e) => setPoDate(e.target.value)}
                className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded text-slate-800 focus:outline-none focus:border-orange-500"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-500 uppercase mb-1">PO Amount (₹)</label>
              <input
                type="number"
                required
                value={poAmount}
                onChange={(e) => setPoAmount(e.target.value)}
                className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded text-slate-800 focus:outline-none focus:border-orange-500 font-bold"
              />
            </div>
          </div>

          <div>
            <label className="block font-bold text-slate-500 uppercase mb-1">PO Amount Type</label>
            <select
              value={poAmountType}
              onChange={(e) => {
                const next = e.target.value as "without_gst" | "with_gst";
                setPoAmountType(next);
                setPoAmount(String((next === "with_gst" ? poWithGstAmount : poBaseAmount).toFixed(2)));
              }}
              className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded text-slate-800 focus:outline-none focus:border-orange-500 font-bold"
            >
              <option value="without_gst">Without GST (pre-GST)</option>
              <option value="with_gst">With GST (GST inclusive)</option>
            </select>
            <p className="mt-1 text-[10px] text-slate-500">Estimate reference: ₹{poBaseAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })} before GST / ₹{poWithGstAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })} including GST.</p>
          </div>

          <div>
            <label className="block font-bold text-slate-500 uppercase mb-1">PO Document File Attachment</label>
            {poFileUrl ? (
              <div className="flex items-center justify-between bg-slate-50 p-2 rounded border border-slate-200">
                <span className="font-bold text-green-700 truncate max-w-[300px]">Document Attached: {fileName || poFileUrl}</span>
                <button type="button" onClick={() => setPoFileUrl("")} className="text-slate-400 hover:text-red-500"><X className="w-4 h-4" /></button>
              </div>
            ) : (
              <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onClick={triggerFileInput}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); triggerFileInput(); } }}
                className={`flex flex-col items-center justify-center border-2 border-dashed rounded p-5 cursor-pointer transition outline-none ${
                  isDragging
                    ? "border-orange-400 bg-orange-50 ring-2 ring-orange-200"
                    : "border-slate-200 hover:bg-slate-50 focus:border-orange-300 focus:ring-2 focus:ring-orange-100"
                }`}
              >
                <FileUp className={`w-7 h-7 mb-2 ${isDragging ? "text-orange-500" : "text-slate-400"}`} />
                <span className="font-bold text-slate-600 text-xs">
                  {uploadingPo ? "Uploading..." : "Drag & drop PO file here, or click to browse"}
                </span>
                <span className="text-[10px] text-slate-400 mt-1 flex items-center gap-1">
                  <ClipboardPaste className="w-3 h-3" /> You can also paste (Ctrl+V) a file or screenshot
                </span>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => handleFileUpload(e, "client_po", setPoFileUrl)}
                />
              </div>
            )}
            {dragError && <p className="text-[10px] text-red-500 mt-1 font-bold">{dragError}</p>}
          </div>

          <div>
            <label className="block font-bold text-slate-500 uppercase mb-1">Remarks / Special Terms</label>
            <textarea
              rows={2}
              value={poRemarks}
              onChange={(e) => setPoRemarks(e.target.value)}
              className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded text-slate-800 focus:outline-none resize-none"
              placeholder="Notes from PO document..."
            ></textarea>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-slate-200 bg-slate-50">
          <button
            type="button"
            onClick={() => setShowPoModal(false)}
            className="py-1.5 px-3 bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 text-xs font-bold rounded transition"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!poFileUrl && !uploadingPo}
            className="py-1.5 px-3 bg-orange-600 hover:bg-orange-500 text-white text-xs font-black rounded transition disabled:opacity-50"
          >
            {isReplacing ? "Save PO Details" : "Submit PO & Issue WCC ready"}
          </button>
        </div>
      </form>
    </div>
  );
};

export default PoUploadModal;
