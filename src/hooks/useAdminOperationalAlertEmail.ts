import { useEffect, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useUserPreferences } from "@/hooks/useUserPreferences";
import { sendAdminAlertEmail, sendEmailInBackground } from "@/services/powerAutomateEmailService";
import type { NotificationPreferences } from "@/types/profile";
import {
  resolveNotificationCategory,
  type NotificationCategory,
} from "@/utils/notificationPreferences";
import { supabase } from "@/utils/supabaseClient";

const OPERATIONAL_ALERT_CATEGORIES = new Set<NotificationCategory>([
  "chargerOffline",
  "chargerFaulted",
  "sessionStarted",
  "sessionStopped",
  "paymentReceived",
  "firmwareAvailable",
]);

function alertTone(type: string): "info" | "warning" | "security" | "success" {
  if (type === "alert") return "security";
  if (type === "warning") return "warning";
  if (type === "success") return "success";
  return "info";
}

/** Sends Power Automate email when an operational notification row is inserted for the signed-in admin. */
export function useAdminOperationalAlertEmail(): void {
  const { user } = useAuth();
  const { notifications: prefs } = useUserPreferences();
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const sentIds = useRef(new Set<string>());

  useEffect(() => {
    if (!user?.id || !user.email) return;
    if (user.role !== "SuperAdmin" && user.role !== "SiteAdmin") return;
    if (!supabase) return;

    const channel = supabase
      .channel(`operational-alert-email:${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "EV_Notifications",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          const id = row.id as string;
          if (sentIds.current.has(id)) return;
          sentIds.current.add(id);

          const title = row.title as string;
          const message = row.message as string;
          const type = (row.type as string) ?? "info";
          const category = resolveNotificationCategory({ title, message, type });

          if (!OPERATIONAL_ALERT_CATEGORIES.has(category)) return;
          if (!prefsRef.current[category as keyof NotificationPreferences]) return;

          sendEmailInBackground(
            sendAdminAlertEmail({
              name: user.name,
              email: user.email,
              subject: `${title} — DFCCIL EV-CMS`,
              headline: title,
              intro: message,
              tone: alertTone(type),
            })
          );
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user?.id, user?.email, user?.name, user?.role]);
}
