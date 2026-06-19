interface UserDeleteModalProps {
  open: boolean;
  userName?: string;
  deleting?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function UserDeleteModal({
  open,
  userName,
  deleting = false,
  onClose,
  onConfirm,
}: UserDeleteModalProps) {
  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={() => !deleting && onClose()} />
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-xl border border-gray-200 p-6 w-full max-w-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 flex items-center justify-center rounded-full bg-red-100">
              <i className="ri-delete-bin-line text-red-600 text-lg" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-gray-900">Delete User</h4>
              <p className="text-xs text-gray-500">This action cannot be undone</p>
            </div>
          </div>
          <p className="text-sm text-gray-600 mb-4">
            {userName ? (
              <>
                Remove <span className="font-medium">{userName}</span>? Associated sessions and
                records will be retained.
              </>
            ) : (
              "Are you sure you want to remove this user? All associated sessions and records will be retained."
            )}
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={deleting}
              className="flex-1 px-4 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors whitespace-nowrap disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={deleting}
              className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition-colors whitespace-nowrap disabled:opacity-50"
            >
              {deleting ? "Deleting…" : "Delete"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
