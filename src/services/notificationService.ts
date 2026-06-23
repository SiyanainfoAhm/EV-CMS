import { requireSupabase } from "@/utils/supabaseClient";
import type { Notification } from "@/types/ev";

export interface NotificationQuery {
  limit?: number;
  unreadOnly?: boolean;
}

function mapRow(row: Record<string, unknown>): Notification {
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

export async function getNotifications(
  userId: string,
  query: NotificationQuery = {}
): Promise<Notification[]> {
  const { limit = 50, unreadOnly = false } = query;
  let q = requireSupabase()
    .from("EV_Notifications")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (unreadOnly) {
    q = q.eq("read", false);
  }

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => mapRow(row as Record<string, unknown>));
}

export async function getUnreadCount(userId: string): Promise<number> {
  const { count, error } = await requireSupabase()
    .from("EV_Notifications")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("read", false);

  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function markAsRead(notificationId: string): Promise<void> {
  const { error } = await requireSupabase()
    .from("EV_Notifications")
    .update({ read: true })
    .eq("id", notificationId);

  if (error) throw new Error(error.message);
}

export async function markAllAsRead(userId: string): Promise<void> {
  const { error } = await requireSupabase()
    .from("EV_Notifications")
    .update({ read: true })
    .eq("user_id", userId)
    .eq("read", false);

  if (error) throw new Error(error.message);
}

export async function notifyUser(
  userId: string,
  title: string,
  message: string,
  type = "info"
): Promise<string> {
  const { data, error } = await requireSupabase().rpc("ev_notify_user", {
    p_user_id: userId,
    p_title: title,
    p_message: message,
    p_type: type,
  });
  if (error) {
    if (error.message?.includes("ev_notify_user")) {
      throw new Error("Run supabase/notifications.sql on Supabase to enable notifications");
    }
    throw new Error(error.message);
  }
  return data as string;
}

export function notificationTypeStyles(type: string): { icon: string; badge: string } {
  switch (type) {
    case "alert":
      return { icon: "ri-error-warning-line", badge: "bg-red-100 text-red-700" };
    case "warning":
      return { icon: "ri-alert-line", badge: "bg-amber-100 text-amber-700" };
    case "success":
      return { icon: "ri-checkbox-circle-line", badge: "bg-emerald-100 text-emerald-700" };
    case "session":
      return { icon: "ri-flashlight-line", badge: "bg-blue-100 text-blue-700" };
    default:
      return { icon: "ri-information-line", badge: "bg-gray-100 text-gray-600" };
  }
}
