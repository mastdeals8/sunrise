import React from "react";
import { X, Upload } from "lucide-react";

interface PoUploadModalProps {
  handlePoSubmit: (e: React.FormEvent) => void;
  setShowPoModal: (v: boolean) => void;
  poNumber: string;
  setPoNumber: (v: string) => void;
  poDate: string;
  setPoDate: (v: string) => void;
  poAmount: string;
  setPoAmount: (v: string) => void;
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
  poFileUrl,
  setPoFileUrl,
  poRemarks,
  setPoRemarks,
  uploadingPo,
  handleFileUpload,
}) => {
  const isReplacing = Boolean(poFileUrl || poNumber);
  const fileName = poFileUrl ? poFileUrl.split("/").pop() : "";
  return (
    <div data-qa="po-upload-modal" className="fixed inset-0 z-[100] bg-slate-900/60 flex items-center justify-center p-4">
      <form onSubmit={handlePoSubmit} className="bg-white w-full max-w-lg rounded-lg shadow-2xl border border-slate-200 overflow-hidden">
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
            <label className="block font-bold text-slate-500 uppercase mb-1">PO Document File Attachment</label>
            {poFileUrl ? (
              <div className="flex items-center justify-between bg-slate-50 p-2 rounded border border-slate-200">
                <span className="font-bold text-green-700 truncate max-w-[300px]">Document Attached: {fileName || poFileUrl}</span>
                <button type="button" onClick={() => setPoFileUrl("")} className="text-slate-400 hover:text-red-500"><X className="w-4 h-4" /></button>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center border-2 border-dashed border-slate-200 rounded p-4 hover:bg-slate-50 cursor-pointer transition">
                <Upload className="w-6 h-6 text-slate-400 mb-2" />
                <span className="font-bold text-slate-600 text-xs">Click to browse and upload PO PDF or Image</span>
                <span className="text-[10px] text-slate-400 mt-1">Files saved locally inside workspace uploads/</span>
                <input type="file" className="hidden" onChange={(e) => handleFileUpload(e, "client_po", setPoFileUrl)} />
              </label>
            )}
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
