import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/utils/supabaseClient";
import * as notificationService from "@/services/notificationService";
import { formatRelativeTime } from "@/utils/supabaseMappers";
import type { Notification } from "@/types/ev";

type Filter = "all" | "unread";

export default function NotificationsPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<Notification[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const data = await notificationService.getNotifications(user.id, {
        limit: 100,
        unreadOnly: filter === "unread",
      });
      setItems(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [user?.id, filter]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!user?.id || !supabase) return;

    const channel = supabase
      .channel(`ev-notifications-page-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "EV_Notifications",
          filter: `user_id=eq.${user.id}`,
        },
        () => load()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, load]);

  const [unreadTotal, setUnreadTotal] = useState(0);

  useEffect(() => {
    if (!user?.id) return;
    notificationService.getUnreadCount(user.id).then(setUnreadTotal).catch(console.error);
  }, [user?.id, items]);

  const handleMarkRead = async (id: string) => {
    await notificationService.markAsRead(id);
    await load();
  };

  const handleMarkAll = async () => {
    if (!user?.id) return;
    await notificationService.markAllAsRead(user.id);
    await load();
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900" style={{ fontFamily: "'DM Sans', sans-serif" }}>
            Notifications
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Alerts and activity for your account — updates live from the database
          </p>
        </div>
        {unreadTotal > 0 && (
          <button
            type="button"
            onClick={handleMarkAll}
            className="px-4 py-2 text-sm font-medium text-emerald-700 bg-emerald-50 rounded-lg hover:bg-emerald-100 transition-colors whitespace-nowrap"
          >
            Mark all as read
          </button>
        )}
      </div>

      <div className="flex items-center gap-2">
        {(["all", "unread"] as Filter[]).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors capitalize whitespace-nowrap ${
              filter === f ? "bg-emerald-600 text-white" : "bg-white border border-gray-200 text-gray-600 hover:text-gray-800"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
        {loading && items.length === 0 ? (
          <p className="p-8 text-center text-sm text-gray-500">Loading notifications…</p>
        ) : items.length === 0 ? (
          <p className="p-8 text-center text-sm text-gray-500">
            {filter === "unread" ? "No unread notifications" : "No notifications yet"}
          </p>
        ) : (
          items.map((n) => {
            const { icon, badge } = notificationService.notificationTypeStyles(n.type);
            return (
              <div
                key={n.id}
                className={`flex gap-4 p-4 ${!n.read ? "bg-emerald-50/30" : ""}`}
              >
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${badge}`}>
                  <i className={`${icon} text-lg`}></i>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className={`text-sm ${!n.read ? "font-semibold text-gray-900" : "font-medium text-gray-800"}`}>
                      {n.title}
                    </p>
                    <span className="text-xs text-gray-400 whitespace-nowrap">{formatRelativeTime(n.createdAt)}</span>
                  </div>
                  <p className="text-sm text-gray-600 mt-1">{n.message}</p>
                  <div className="flex items-center gap-3 mt-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${badge}`}>{n.type}</span>
                    {!n.read && (
                      <button
                        type="button"
                        onClick={() => handleMarkRead(n.id)}
                        className="text-xs font-medium text-emerald-600 hover:text-emerald-700"
                      >
                        Mark as read
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
