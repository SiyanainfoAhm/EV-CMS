// Sends Expo (mobile) and FCM (web admin) push for EV_Notifications rows.
// Deploy: supabase functions deploy send-push-notification --no-verify-jwt
// Secrets: FIREBASE_SERVICE_ACCOUNT_JSON (full JSON). Dispatch secret: EV_SystemConfig or EV_PUSH_DISPATCH_SECRET env.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { create, getNumericDate } from "https://deno.land/x/djwt@v2.8/mod.ts";

const EXPO_PUSH_URL = "https://expo.host/--/api/v2/push/send";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-ev-push-secret",
};

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

async function getGoogleAccessToken(serviceAccount: ServiceAccount): Promise<string> {
  const jwt = await create(
    { alg: "RS256", typ: "JWT" },
    {
      iss: serviceAccount.client_email,
      sub: serviceAccount.client_email,
      aud: "https://oauth2.googleapis.com/token",
      iat: getNumericDate(0),
      exp: getNumericDate(3600),
      scope: "https://www.googleapis.com/auth/firebase.messaging",
    },
    serviceAccount.private_key
  );

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!res.ok) throw new Error(`Google OAuth failed: ${res.status}`);
  const data = await res.json();
  return data.access_token as string;
}

async function sendFcmWeb(
  accessToken: string,
  projectId: string,
  token: string,
  title: string,
  body: string,
  data: Record<string, unknown>
): Promise<void> {
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: {
        token,
        notification: { title, body },
        data: Object.fromEntries(
          Object.entries(data).map(([k, v]) => [k, v == null ? "" : String(v)])
        ),
        webpush: {
          fcm_options: { link: "/notifications" },
        },
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`FCM send failed (${res.status}): ${text}`);
  }
}

async function sendWebPushVapid(
  subscriptionJson: string,
  title: string,
  body: string,
  data: Record<string, unknown>,
  vapidPublic: string,
  vapidPrivate: string
): Promise<void> {
  const webpush = await import("npm:web-push@3.6.7");
  webpush.setVapidDetails("mailto:anita.desai@dfccil.gov.in", vapidPublic, vapidPrivate);

  const subscription = JSON.parse(subscriptionJson) as {
    endpoint: string;
    keys: { auth: string; p256dh: string };
  };

  await webpush.sendNotification(
    subscription,
    JSON.stringify({
      title,
      body,
      url: "/notifications",
      data,
    })
  );
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { data: configSecret } = await supabase.rpc("ev_get_system_config", {
      p_key: "ev_push_dispatch_secret",
    });
    const dispatchSecret =
      typeof configSecret === "string" && configSecret
        ? configSecret
        : (Deno.env.get("EV_PUSH_DISPATCH_SECRET") ?? "");

    const headerSecret = req.headers.get("x-ev-push-secret") ?? "";
    if (!dispatchSecret || headerSecret !== dispatchSecret) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { notificationId } = await req.json();
    if (!notificationId) {
      return new Response(JSON.stringify({ error: "notificationId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: notification, error: nErr } = await supabase
      .from("EV_Notifications")
      .select("id, user_id, title, message, type, reference_type, reference_id, data, push_sent")
      .eq("id", notificationId)
      .maybeSingle();

    if (nErr || !notification) {
      return new Response(JSON.stringify({ error: "Notification not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (notification.push_sent) {
      return new Response(JSON.stringify({ sent: 0, message: "Already sent" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: tokens, error: tErr } = await supabase
      .from("EV_UserPushTokens")
      .select("token, token_type")
      .eq("user_id", notification.user_id)
      .eq("is_active", true);

    if (tErr) throw tErr;

    const expoTokens = (tokens ?? []).filter((r) => (r.token_type ?? "expo") === "expo");
    const fcmTokens = (tokens ?? []).filter((r) => r.token_type === "fcm_web");
    const webPushTokens = (tokens ?? []).filter((r) => r.token_type === "web_push");

    const vapidPublic = Deno.env.get("WEB_PUSH_VAPID_PUBLIC_KEY") ?? "";
    const vapidPrivate = Deno.env.get("WEB_PUSH_VAPID_PRIVATE_KEY") ?? "";

    let sent = 0;
    const payloadData = {
      notificationId: notification.id,
      type: notification.type,
      reference_id: notification.reference_id,
      reference_type: notification.reference_type,
      url: "/notifications",
      ...(notification.data ?? {}),
    };

    if (expoTokens.length) {
      const messages = expoTokens.map((row: { token: string }) => ({
        to: row.token,
        sound: "default",
        title: notification.title,
        body: notification.message,
        data: payloadData,
      }));

      const pushRes = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(messages),
      });

      if (!pushRes.ok) throw new Error(`Expo push failed: ${pushRes.status}`);
      sent += messages.length;
    }

    const saJson = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON");
    if (fcmTokens.length && saJson) {
      const serviceAccount = JSON.parse(saJson) as ServiceAccount;
      const accessToken = await getGoogleAccessToken(serviceAccount);
      for (const row of fcmTokens) {
        await sendFcmWeb(
          accessToken,
          serviceAccount.project_id,
          row.token,
          notification.title,
          notification.message,
          payloadData
        );
        sent += 1;
      }
    }

    if (webPushTokens.length && vapidPublic && vapidPrivate) {
      for (const row of webPushTokens) {
        await sendWebPushVapid(
          row.token,
          notification.title,
          notification.message,
          payloadData,
          vapidPublic,
          vapidPrivate
        );
        sent += 1;
      }
    }

    await supabase
      .from("EV_Notifications")
      .update({ push_sent: true, push_sent_at: new Date().toISOString() })
      .eq("id", notificationId);

    return new Response(
      JSON.stringify({
        sent,
        expo: expoTokens.length,
        fcm: fcmTokens.length,
        web_push: webPushTokens.length,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
