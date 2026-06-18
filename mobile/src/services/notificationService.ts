import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { requireSupabase } from "../utils/supabaseClient";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * FCM via Expo Push — requires EAS projectId.
 * Token is stored against EV_Users.id (custom auth user id).
 */
export async function registerForPushNotifications(userId: string): Promise<string | null> {
  try {
    if (!Device.isDevice) {
      console.log("[push] Physical device required for push notifications.");
      return null;
    }

    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;
    if (existing !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== "granted") {
      console.log("[push] Permission denied.");
      return null;
    }

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "default",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#FF231F7C",
      });
    }

    const projectId =
      Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;

    if (!projectId) {
      console.log("[push] Expo projectId missing — check app.json extra.eas.projectId.");
      return null;
    }

    const tokenResponse = await Notifications.getExpoPushTokenAsync({ projectId });
    const token = tokenResponse.data;
    await savePushToken(userId, token);
    return token;
  } catch (error) {
    console.error("[push] Registration failed:", error);
    return null;
  }
}

export async function savePushToken(userId: string, token: string): Promise<void> {
  const { error } = await requireSupabase().from("EV_UserPushTokens").upsert(
    {
      user_id: userId,
      token,
      token_type: "expo",
      platform: Platform.OS,
      device_name: Device.deviceName ?? null,
      is_active: true,
      last_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,token" }
  );
  if (error) throw error;
}

export async function deactivatePushTokens(userId: string): Promise<void> {
  const { error } = await requireSupabase()
    .from("EV_UserPushTokens")
    .update({
      is_active: false,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);

  if (error) console.error("[push] Failed to deactivate tokens:", error);
}

/** @deprecated Use deactivatePushTokens */
export async function removePushTokenOnLogout(userId: string): Promise<void> {
  await deactivatePushTokens(userId);
}

export async function registerPushToken(userId: string): Promise<string | null> {
  return registerForPushNotifications(userId);
}

export function setupNotificationListeners(
  onNotificationPress?: (data: Record<string, unknown>) => void
): () => void {
  const receivedSubscription = Notifications.addNotificationReceivedListener((notification) => {
    console.log("[push] Received:", notification.request.identifier);
  });

  const responseSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = (response.notification.request.content.data ?? {}) as Record<string, unknown>;
    console.log("[push] Opened:", data);
    onNotificationPress?.(data);
  });

  return () => {
    receivedSubscription.remove();
    responseSubscription.remove();
  };
}

export function addNotificationReceivedListener(
  listener: (notification: Notifications.Notification) => void
) {
  return Notifications.addNotificationReceivedListener(listener);
}

export function addNotificationResponseListener(
  listener: (response: Notifications.NotificationResponse) => void
) {
  return Notifications.addNotificationResponseReceivedListener(listener);
}
