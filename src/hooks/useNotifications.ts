import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/utils/supabaseClient";
import * as notificationService from "@/services/notificationService";
import type { Notification } from "@/types/ev";

export function useNotifications(userId: string | undefined, previewLimit = 8) {
  const [items, setItems] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!userId) {
      setItems([]);
      setUnreadCount(0);
      return;
    }
    setLoading(true);
    try {
      const [list, count] = await Promise.all([
        notificationService.getNotifications(userId, { limit: previewLimit }),
        notificationService.getUnreadCount(userId),
      ]);
      setItems(list);
      setUnreadCount(count);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [userId, previewLimit]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!userId || !supabase) return;

    const channel = supabase
      .channel(`ev-notifications-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "EV_Notifications",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          refresh();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, refresh]);

  const markRead = useCallback(
    async (id: string) => {
      await notificationService.markAsRead(id);
      await refresh();
    },
    [refresh]
  );

  const markAllRead = useCallback(async () => {
    if (!userId) return;
    await notificationService.markAllAsRead(userId);
    await refresh();
  }, [userId, refresh]);

  return { items, unreadCount, loading, refresh, markRead, markAllRead };
}
