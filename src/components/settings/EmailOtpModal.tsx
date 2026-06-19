import { useState } from "react";

interface EmailOtpModalProps {
  open: boolean;
  newEmail: string;
  sending: boolean;
  verifying: boolean;
  error?: string | null;
  onClose: () => void;
  onResend: () => void;
  onVerify: (otp: string) => void;
}

export default function EmailOtpModal({
  open,
  newEmail,
  sending,
  verifying,
  error,
  onClose,
  onResend,
  onVerify,
}: EmailOtpModalProps) {
  const [otp, setOtp] = useState("");

  if (!open) return null;

  const busy = sending || verifying;

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={() => !busy && onClose()} />
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-xl border border-gray-200 p-6 w-full max-w-md">
          <h4 className="text-lg font-semibold text-gray-900 mb-1">Verify your new email</h4>
          <p className="text-sm text-gray-500 mb-4">
            We sent a 6-digit code to <span className="font-medium text-gray-800">{newEmail}</span>. Enter it below to
            confirm your email change.
          </p>

          {error && (
            <p className="mb-3 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>
          )}

          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="000000"
            disabled={busy}
            className="w-full px-3 py-3 border border-gray-200 rounded-lg text-lg text-center font-mono tracking-widest mb-4 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            autoFocus
          />

          <p className="text-xs text-gray-400 mb-4">Code expires in 10 minutes.</p>

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              onClick={onResend}
              disabled={busy}
              className="flex-1 px-4 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              {sending ? "Sending…" : "Resend code"}
            </button>
            <button
              type="button"
              onClick={() => onVerify(otp)}
              disabled={busy || otp.length !== 6}
              className="flex-1 px-4 py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
            >
              {verifying ? "Verifying…" : "Verify & save"}
            </button>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="mt-3 w-full text-sm text-gray-500 hover:text-gray-700 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </>
  );
}
