import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/utils/supabaseClient";
import * as notificationService from "@/services/notificationService";
import { useUserPreferences } from "@/hooks/useUserPreferences";
import { isNotificationEnabled } from "@/utils/notificationPreferences";
import type { Notification } from "@/types/ev";

function mapRealtimeRow(row: Record<string, unknown>): Notification {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    title: row.title as string,
    message: row.message as string,
    type: (row.type as string) ?? "info",
    read: Boolean(row.read),
    createdAt: row.created_at as string,
  };
}

export function useNotifications(userId: string | undefined, previewLimit = 8) {
  const { notifications: prefs } = useUserPreferences();
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  const [items, setItems] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const filterEnabled = useCallback(
    (list: Notification[]) =>
      list.filter((n) => isNotificationEnabled(n, prefsRef.current)),
    []
  );

  const syncUnreadCount = useCallback(
    async (uid: string) => {
      const unread = await notificationService.getNotifications(uid, {
        limit: 100,
        unreadOnly: true,
      });
      setUnreadCount(filterEnabled(unread).length);
    },
    [filterEnabled]
  );

  const refresh = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!userId) {
        setItems([]);
        setUnreadCount(0);
        return;
      }
      if (!options?.silent) setLoading(true);
      try {
        const list = await notificationService.getNotifications(userId, {
          limit: previewLimit * 3,
        });
        const filtered = filterEnabled(list).slice(0, previewLimit);
        setItems(filtered);
        await syncUnreadCount(userId);
      } catch (e) {
        console.error(e);
      } finally {
        if (!options?.silent) setLoading(false);
      }
    },
    [userId, previewLimit, filterEnabled, syncUnreadCount]
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!userId || !supabase) return;

    const applyInsert = (row: Record<string, unknown>) => {
      const notification = mapRealtimeRow(row);
      if (!isNotificationEnabled(notification, prefsRef.current)) return;

      setItems((prev) => {
        if (prev.some((n) => n.id === notification.id)) return prev;
        return [notification, ...prev].slice(0, previewLimit);
      });
      if (!notification.read) {
        setUnreadCount((c) => c + 1);
      }
    };

    const applyUpdate = (row: Record<string, unknown>, oldRow?: Record<string, unknown>) => {
      const notification = mapRealtimeRow(row);
      const wasUnread = oldRow ? !Boolean(oldRow.read) : false;
      const enabled = isNotificationEnabled(notification, prefsRef.current);

      setItems((prev) => {
        const next = prev.map((n) => (n.id === notification.id ? notification : n));
        if (!prev.some((n) => n.id === notification.id) && enabled) {
          return [notification, ...prev].slice(0, previewLimit);
        }
        return enabled ? next : next.filter((n) => n.id !== notification.id);
      });

      if (wasUnread && notification.read) {
        setUnreadCount((c) => Math.max(0, c - 1));
      } else if (!wasUnread && !notification.read && enabled) {
        setUnreadCount((c) => c + 1);
      }
    };

    const applyDelete = (row: Record<string, unknown>) => {
      const id = row.id as string;
      const wasUnread = !Boolean(row.read);
      setItems((prev) => prev.filter((n) => n.id !== id));
      if (wasUnread) {
        setUnreadCount((c) => Math.max(0, c - 1));
      }
    };

    const channel = supabase
      .channel(`ev-notifications-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "EV_Notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          if (payload.new) applyInsert(payload.new as Record<string, unknown>);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "EV_Notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          if (payload.new) {
            applyUpdate(
              payload.new as Record<string, unknown>,
              payload.old as Record<string, unknown> | undefined
            );
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "EV_Notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          if (payload.old) applyDelete(payload.old as Record<string, unknown>);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, previewLimit]);

  useEffect(() => {
    if (!userId) return;
    void syncUnreadCount(userId);
    void refresh({ silent: true });
  }, [prefs, userId, syncUnreadCount, refresh]);

  const markRead = useCallback(
    async (id: string) => {
      setItems((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n))
      );
      setUnreadCount((c) => Math.max(0, c - 1));
      await notificationService.markAsRead(id);
      await refresh({ silent: true });
    },
    [refresh]
  );

  const markAllRead = useCallback(async () => {
    if (!userId) return;
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
    await notificationService.markAllAsRead(userId);
    await refresh({ silent: true });
  }, [userId, refresh]);

  return { items, unreadCount, loading, refresh, markRead, markAllRead };
}
