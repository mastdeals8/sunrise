import React, { useState, useEffect } from "react";
import { MessageCircle, Send, X, CheckCircle2, AlertTriangle, Phone, FileText, ExternalLink } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";

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
}) => {
  const { token } = useAuth();
  const [phone, setPhone] = useState(defaultPhone);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
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
  }, [isOpen, defaultPhone, recipientName, documentType, documentNumber, totalAmount]);

  if (!isOpen) return null;

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone.trim()) {
      setResult({ ok: false, text: "Recipient phone number is required." });
      return;
    }

    setSending(true);
    setResult(null);

    try {
      const payload: any = {
        to: phone.trim(),
        text: message.trim(),
        companyId,
      };

      if (documentUrl) {
        payload.mediaUrl = documentUrl.startsWith("http") ? documentUrl : `${window.location.origin}${documentUrl}`;
        payload.caption = message.trim();
        payload.fileName = `${documentType.toUpperCase()}-${documentNumber || "doc"}.pdf`;
        payload.mediaType = "document";
      }

      const res = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setResult({
          ok: true,
          text: `Successfully dispatched to ${phone}! WhatsApp Message ID: ${data.messageId || "Delivered"}`,
        });
        setTimeout(() => {
          onClose();
        }, 2200);
      } else {
        setResult({
          ok: false,
          text: data.message || "Failed to dispatch WhatsApp message. Ensure session is connected in WhatsApp Settings.",
        });
      }
    } catch (err: any) {
      setResult({ ok: false, text: err.message || "Network error while sending WhatsApp message." });
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

          {documentUrl && (
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between text-xs text-slate-700">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-blue-600" />
                <span className="font-semibold">{documentType.toUpperCase()} PDF attached</span>
              </div>
              <span className="text-[10px] uppercase font-bold text-slate-400">Auto-sent</span>
            </div>
          )}

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
              className="px-4 py-2 border border-slate-200 hover:bg-slate-50 text-slate-600 text-xs font-bold rounded-xl transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={sending || !phone.trim()}
              className="inline-flex items-center gap-1.5 px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl transition shadow-sm disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              {sending ? "Sending WhatsApp..." : "Send via WhatsApp"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
