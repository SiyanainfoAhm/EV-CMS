import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useNotifications } from "@/hooks/useNotifications";
import * as notificationService from "@/services/notificationService";
import { formatRelativeTime } from "@/utils/supabaseMappers";

export default function NotificationBell() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const { items, unreadCount, loading, markRead, markAllRead } = useNotifications(user?.id, 6);
  const [badgePulse, setBadgePulse] = useState(false);
  const prevUnreadRef = useRef(unreadCount);

  useEffect(() => {
    if (unreadCount > prevUnreadRef.current) {
      setBadgePulse(true);
      const timer = setTimeout(() => setBadgePulse(false), 1200);
      prevUnreadRef.current = unreadCount;
      return () => clearTimeout(timer);
    }
    prevUnreadRef.current = unreadCount;
  }, [unreadCount]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const handleItemClick = async (id: string, read: boolean) => {
    if (!read) await markRead(id);
    setOpen(false);
    navigate("/notifications");
  };

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative w-9 h-9 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors"
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
        aria-expanded={open}
      >
        <i className="ri-notification-3-line text-gray-600 text-lg"></i>
        {unreadCount > 0 && (
          <span
            className={`absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center bg-emerald-500 text-white text-[10px] font-bold rounded-full transition-transform ${
              badgePulse ? "scale-125 ring-2 ring-emerald-300" : ""
            }`}
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-96 max-w-[calc(100vw-2rem)] bg-white rounded-xl shadow-lg border border-gray-200 z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <div>
              <p className="text-sm font-semibold text-gray-900">Notifications</p>
              <p className="text-xs text-gray-500">
                {unreadCount > 0 ? `${unreadCount} unread` : "All caught up"}
              </p>
            </div>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={() => markAllRead()}
                className="text-xs font-medium text-emerald-600 hover:text-emerald-700 whitespace-nowrap"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {loading && items.length === 0 ? (
              <p className="px-4 py-6 text-sm text-gray-500 text-center">Loading…</p>
            ) : items.length === 0 ? (
              <p className="px-4 py-6 text-sm text-gray-500 text-center">No notifications yet</p>
            ) : (
              items.map((n) => {
                const { icon, badge } = notificationService.notificationTypeStyles(n.type);
                return (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => handleItemClick(n.id, n.read)}
                    className={`w-full text-left px-4 py-3 border-b border-gray-50 hover:bg-gray-50 transition-colors ${
                      !n.read ? "bg-emerald-50/40" : ""
                    }`}
                  >
                    <div className="flex gap-3">
                      <div
                        className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${badge}`}
                      >
                        <i className={`${icon} text-base`}></i>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className={`text-sm truncate ${!n.read ? "font-semibold text-gray-900" : "font-medium text-gray-800"}`}>
                            {n.title}
                          </p>
                          {!n.read && <span className="w-2 h-2 bg-emerald-500 rounded-full flex-shrink-0 mt-1.5" />}
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{n.message}</p>
                        <p className="text-[11px] text-gray-400 mt-1">{formatRelativeTime(n.createdAt)}</p>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              setOpen(false);
              navigate("/notifications");
            }}
            className="w-full px-4 py-3 text-sm font-medium text-emerald-600 hover:bg-emerald-50 border-t border-gray-100 transition-colors"
          >
            View all notifications
          </button>
        </div>
      )}
    </div>
  );
}
