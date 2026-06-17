// Supabase Edge Function placeholder — send Expo push after notification insert.
// Deploy: supabase functions deploy send-push-notification
// Invoke from backend/webhook with service role only (never from mobile).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

serve(async (req) => {
  try {
    const { notificationId } = await req.json();

    // TODO: Validate caller (service role / internal secret header).

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // TODO: Read notification by ID from EV_Notifications.
    const { data: notification, error: nErr } = await supabase
      .from("EV_Notifications")
      .select("id, user_id, title, message, type, reference_type, reference_id, data")
      .eq("id", notificationId)
      .maybeSingle();

    if (nErr || !notification) {
      return new Response(JSON.stringify({ error: "Notification not found" }), { status: 404 });
    }

    // TODO: Fetch active Expo tokens for notification.user_id from EV_UserPushTokens.
    const { data: tokens, error: tErr } = await supabase
      .from("EV_UserPushTokens")
      .select("token")
      .eq("user_id", notification.user_id)
      .eq("is_active", true);

    if (tErr) throw tErr;
    if (!tokens?.length) {
      return new Response(JSON.stringify({ sent: 0, message: "No active tokens" }), { status: 200 });
    }

    // TODO: Send to Expo Push API (batch), handle tickets/errors.
    const messages = tokens.map((row: { token: string }) => ({
      to: row.token,
      sound: "default",
      title: notification.title,
      body: notification.message,
      data: {
        type: notification.type,
        reference_id: notification.reference_id,
        reference_type: notification.reference_type,
        ...(notification.data ?? {}),
      },
    }));

    const pushRes = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(messages),
    });

    if (!pushRes.ok) {
      throw new Error(`Expo push failed: ${pushRes.status}`);
    }

    // TODO: Update EV_Notifications.push_sent = true, push_sent_at = now().
    await supabase
      .from("EV_Notifications")
      .update({ push_sent: true, push_sent_at: new Date().toISOString() })
      .eq("id", notificationId);

    return new Response(JSON.stringify({ sent: messages.length }), { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
