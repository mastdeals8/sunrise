import React, { useState, useEffect, useRef } from "react";
import {
  MessageCircle,
  Send,
  X,
  CheckCircle2,
  AlertTriangle,
  Phone,
  FileText,
  Eye,
  Download,
  RotateCcw,
  Loader2,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { isBoltMode } from "../lib/supabase";
import { getEstimatePdfFilename, downloadFileBlob } from "../pages/operations/utils/estimatePdfExport";

export interface WhatsAppShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultPhone?: string;
  recipientName?: string;
  documentType: "invoice" | "estimate" | "wcc" | "dc" | "custom";
  documentNumber?: string;
  documentUrl?: string;
  totalAmount?: number;
  companyId?: number;
  estimateId?: number;
  estimate?: any;
  stores?: any[];
}

export const WhatsAppShareModal: React.FC<WhatsAppShareModalProps> = ({
  isOpen,
  onClose,
  defaultPhone = "",
  recipientName = "Client",
  documentType,
  documentNumber = "",
  documentUrl,
  totalAmount,
  companyId = 1,
  estimateId,
  estimate,
  stores = [],
}) => {
  const { token } = useAuth();
  const [phone, setPhone] = useState(defaultPhone);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  // PDF Attachment State
  const [pdfStatus, setPdfStatus] = useState<"idle" | "generating" | "ready" | "error">("idle");
  const [pdfFilename, setPdfFilename] = useState("");
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);
  const [pdfObjectUrl, setPdfObjectUrl] = useState<string | null>(null);
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);
  const [pdfFileSizeBytes, setPdfFileSizeBytes] = useState(0);
  const [pdfError, setPdfError] = useState<string | null>(null);

  // Keep track of active object URL for cleanup
  const activeObjectUrlRef = useRef<string | null>(null);

  const cleanupObjectUrl = () => {
    if (activeObjectUrlRef.current) {
      URL.revokeObjectURL(activeObjectUrlRef.current);
      activeObjectUrlRef.current = null;
    }
  };

  // Generate or fetch the canonical PDF
  const loadPdf = async () => {
    cleanupObjectUrl();
    setPdfStatus("generating");
    setPdfError(null);
    setPdfBlob(null);
    setPdfObjectUrl(null);
    setPdfBase64(null);

    // Compute canonical filename
    let filename = "";
    if (documentType === "estimate" && (estimate || documentNumber)) {
      filename = getEstimatePdfFilename(estimate || { estimateNumber: documentNumber }, stores);
    } else {
      const sanitizedNum = (documentNumber || "doc").replace(/[/\\?%*:|"<>]/g, "-");
      filename = `${documentType.toUpperCase()}-${sanitizedNum}.pdf`;
    }
    setPdfFilename(filename);

    try {
      // Determine target endpoint
      const targetUrl =
        documentType === "estimate" && estimateId
          ? `/api/operations/estimates/${estimateId}/pdf`
          : documentUrl;

      if (!targetUrl) {
        throw new Error("No PDF source URL available for this document");
      }

      if (isBoltMode) {
        // Bolt preview mock PDF
        const mockContent = `%PDF-1.4\n1 0 obj\n<< /Title (${filename}) >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF`;
        const blob = new Blob([mockContent], { type: "application/pdf" });
        const objUrl = URL.createObjectURL(blob);
        activeObjectUrlRef.current = objUrl;
        const b64 = `data:application/pdf;base64,${btoa(mockContent)}`;
        setPdfBlob(blob);
        setPdfObjectUrl(objUrl);
        setPdfBase64(b64);
        setPdfFileSizeBytes(blob.size);
        setPdfStatus("ready");
        return;
      }

      const headers: Record<string, string> = {};
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const res = await fetch(targetUrl, { headers });
      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        throw new Error(`Failed to generate PDF (${res.status}): ${errBody || res.statusText}`);
      }

      const arrayBuffer = await res.arrayBuffer();
      const blob = new Blob([arrayBuffer], { type: "application/pdf" });
      const objUrl = URL.createObjectURL(blob);
      activeObjectUrlRef.current = objUrl;

      // Convert to base64
      const reader = new FileReader();
      reader.onloadend = () => {
        const b64 = reader.result as string;
        setPdfBlob(blob);
        setPdfObjectUrl(objUrl);
        setPdfBase64(b64);
        setPdfFileSizeBytes(blob.size);
        setPdfStatus("ready");
      };
      reader.onerror = () => {
        throw new Error("Failed to process generated PDF data");
      };
      reader.readAsDataURL(blob);
    } catch (err: any) {
      console.error("[WhatsAppShareModal-pdf-load-error]", err);
      setPdfStatus("error");
      setPdfError(err.message || "Failed to prepare estimate PDF");
    }
  };

  useEffect(() => {
    if (!isOpen) {
      cleanupObjectUrl();
      return;
    }

    setPhone(defaultPhone);
    const docLabel =
      documentType === "invoice"
        ? "Invoice"
        : documentType === "estimate"
        ? "Estimate / Quotation"
        : documentType === "wcc"
        ? "Work Completion Certificate"
        : documentType === "dc"
        ? "Delivery Challan"
        : "Document";

    const amountStr = totalAmount ? ` amounting to ₹${Number(totalAmount).toLocaleString("en-IN")}` : "";

    const defaultMsg = `Dear ${recipientName || "Sir/Madam"},\n\nPlease find attached ${docLabel} ${documentNumber}${amountStr}.\n\nPlease let us know if you need any clarification.\n\nWarm regards,\nSunrise Media`;
    setMessage(defaultMsg);
    setResult(null);

    // Prepare PDF automatically when modal opens
    loadPdf();

    return () => {
      cleanupObjectUrl();
    };
  }, [isOpen, defaultPhone, recipientName, documentType, documentNumber, totalAmount, estimateId]);

  if (!isOpen) return null;

  const handlePreviewPdf = () => {
    if (pdfObjectUrl) {
      window.open(pdfObjectUrl, "_blank");
    } else if (estimateId) {
      window.open(`/api/operations/estimates/${estimateId}/pdf`, "_blank");
    }
  };

  const handleDownloadPdf = () => {
    if (pdfBlob) {
      downloadFileBlob(pdfBlob, pdfFilename || "Estimate.pdf");
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();

    const cleanDigits = phone.replace(/\D/g, "");
    if (!cleanDigits || cleanDigits.length < 10) {
      setResult({ ok: false, text: "Recipient WhatsApp phone number must contain at least 10 digits." });
      return;
    }

    if (pdfStatus === "generating") {
      setResult({ ok: false, text: "Please wait for the Estimate PDF to finish generating before sending." });
      return;
    }

    if (pdfStatus === "error" || (!pdfBase64 && !documentUrl)) {
      setResult({
        ok: false,
        text: "Estimate PDF attachment is required. Please retry PDF generation before sending.",
      });
      return;
    }

    setSending(true);
    setResult(null);

    try {
      const payload: any = {
        to: phone.trim(),
        text: message.trim(),
        caption: message.trim(),
        companyId,
        estimateId: documentType === "estimate" ? estimateId : undefined,
        fileName: pdfFilename,
        mediaType: "document",
      };

      if (pdfBase64) {
        payload.mediaBase64 = pdfBase64;
      } else if (documentUrl) {
        payload.mediaUrl = documentUrl.startsWith("http") ? documentUrl : `${window.location.origin}${documentUrl}`;
      }

      const res = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok && data.success) {
        setResult({
          ok: true,
          text: `Successfully dispatched to ${phone}! WhatsApp Message ID: ${data.messageId || "Delivered"}`,
        });
        setTimeout(() => {
          onClose();
        }, 2200);
      } else {
        // Requirement 10: Preserve message and PDF on failure so user can retry without rebuilding
        setResult({
          ok: false,
          text:
            data.message ||
            data.error ||
            "Failed to dispatch WhatsApp message with PDF attachment. Ensure WhatsApp instance is connected in Settings.",
        });
      }
    } catch (err: any) {
      setResult({
        ok: false,
        text: err.message || "Network error while sending WhatsApp message.",
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl shadow-xl border border-slate-100 max-w-lg w-full overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-emerald-50/50">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-500 text-white flex items-center justify-center shadow-xs">
              <MessageCircle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-sm">Send {documentType.toUpperCase()} via WhatsApp</h3>
              <p className="text-[11px] text-slate-500 font-mono">{documentNumber || recipientName}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Form */}
        <form onSubmit={handleSend} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center justify-between">
              <span>Recipient WhatsApp Phone</span>
              <span className="text-[10px] text-slate-400 font-normal">Format: 9823633833 or +919823633833</span>
            </label>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Enter client mobile number"
                className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-xl text-xs font-mono focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Message Content</label>
            <textarea
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 leading-relaxed"
            />
          </div>

          {/* Attached Document Status Card */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-red-100 text-red-600 flex items-center justify-center shrink-0">
                  <FileText className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-bold text-slate-800 truncate" title={pdfFilename}>
                    {pdfFilename || `${documentType.toUpperCase()}-${documentNumber || "doc"}.pdf`}
                  </div>
                  <div className="text-[11px] flex items-center gap-1.5 mt-0.5">
                    {pdfStatus === "generating" && (
                      <span className="text-amber-600 font-medium inline-flex items-center gap-1">
                        <Loader2 className="w-3 h-3 animate-spin" /> Preparing PDF...
                      </span>
                    )}
                    {pdfStatus === "ready" && (
                      <span className="text-emerald-700 font-medium inline-flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Attached • {(pdfFileSizeBytes / 1024).toFixed(1)} KB
                      </span>
                    )}
                    {pdfStatus === "error" && (
                      <span className="text-red-600 font-medium inline-flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" /> PDF generation failed
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Action Buttons: Preview, Download, or Retry */}
              <div className="flex items-center gap-1.5 shrink-0">
                {pdfStatus === "ready" && (
                  <>
                    <button
                      type="button"
                      onClick={handlePreviewPdf}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 transition shadow-xs cursor-pointer"
                      title="Preview generated PDF in a new tab"
                    >
                      <Eye className="w-3.5 h-3.5 text-slate-600" />
                      Preview
                    </button>
                    <button
                      type="button"
                      onClick={handleDownloadPdf}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 transition shadow-xs cursor-pointer"
                      title="Download PDF to your computer"
                    >
                      <Download className="w-3.5 h-3.5 text-slate-600" />
                      Download
                    </button>
                  </>
                )}
                {pdfStatus === "error" && (
                  <button
                    type="button"
                    onClick={loadPdf}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition shadow-xs cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Retry PDF
                  </button>
                )}
              </div>
            </div>

            {pdfStatus === "error" && (
              <div className="text-[11px] text-red-700 bg-red-100/50 p-2 rounded-lg border border-red-200">
                {pdfError || "Unable to render estimate PDF document."}
              </div>
            )}
          </div>

          {result && (
            <div
              className={`text-xs p-3 rounded-xl border flex items-start gap-2 ${
                result.ok ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-red-50 border-red-200 text-red-800"
              }`}
            >
              {result.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
              <div>
                <span>{result.text}</span>
                {!result.ok && (
                  <p className="mt-1 text-[11px]">
                    <a href="/automation/whatsapp" className="underline font-bold text-red-900" target="_blank" rel="noreferrer">
                      Open WhatsApp Settings &rarr;
                    </a>
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="pt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={sending}
              className="px-4 py-2 border border-slate-200 hover:bg-slate-50 text-slate-600 text-xs font-bold rounded-xl transition disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={sending || pdfStatus === "generating" || !phone.trim()}
              className="inline-flex items-center gap-1.5 px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl transition shadow-sm disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
            >
              {sending ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Sending WhatsApp...
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5" />
                  Send via WhatsApp
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
