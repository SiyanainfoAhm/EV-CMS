import { requireSupabase } from "../utils/supabaseClient";
import { requireUserId } from "./authService";
import type { AppNotification } from "../types";

function mapRow(row: Record<string, unknown>): AppNotification {
  const data = row.data as Record<string, unknown> | null;
  return {
    id: row.id as string,
    userId: row.user_id as string,
    title: row.title as string,
    body: row.message as string,
    type: (row.type as string) ?? "general",
    referenceType: (row.reference_type as string) ?? null,
    referenceId: (row.reference_id as string) ?? null,
    data: data ?? {},
    isRead: Boolean(row.read),
    pushSent: Boolean(row.push_sent),
    pushSentAt: (row.push_sent_at as string) ?? null,
    createdAt: row.created_at as string,
  };
}

export async function getMyNotifications(userId?: string): Promise<AppNotification[]> {
  const uid = userId ?? requireUserId();
  const { data, error } = await requireSupabase()
    .from("EV_Notifications")
    .select("*")
    .eq("user_id", uid)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) throw error;
  return (data ?? []).map((row) => mapRow(row as Record<string, unknown>));
}

export async function getUnreadNotificationCount(userId?: string): Promise<number> {
  const uid = userId ?? requireUserId();
  const { count, error } = await requireSupabase()
    .from("EV_Notifications")
    .select("*", { count: "exact", head: true })
    .eq("user_id", uid)
    .eq("read", false);

  if (error) throw error;
  return count ?? 0;
}

export async function markNotificationAsRead(notificationId: string, userId?: string): Promise<void> {
  const uid = userId ?? requireUserId();
  const { error } = await requireSupabase()
    .from("EV_Notifications")
    .update({ read: true })
    .eq("id", notificationId)
    .eq("user_id", uid);

  if (error) throw error;
}

export async function markAllNotificationsAsRead(userId?: string): Promise<void> {
  const uid = userId ?? requireUserId();
  const { error } = await requireSupabase()
    .from("EV_Notifications")
    .update({ read: true })
    .eq("user_id", uid)
    .eq("read", false);

  if (error) throw error;
}

export function subscribeToMyNotifications(
  userId: string,
  onNewNotification: (notification: AppNotification) => void
): () => void {
  const channel = requireSupabase()
    .channel(`ev-notifications:${userId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "EV_Notifications",
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        if (payload.new) {
          onNewNotification(mapRow(payload.new as Record<string, unknown>));
        }
      }
    )
    .subscribe();

  return () => {
    requireSupabase().removeChannel(channel);
  };
}
