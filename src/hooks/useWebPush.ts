import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { isWebPushConfiguredAsync } from "@/utils/firebaseWebConfig";
import {
  deactivateWebPush,
  getWebPushSupportStatus,
  isWebPushEnabledInSettings,
  registerWebPush,
  setWebPushEnabledInSettings,
  showLocalBrowserNotification,
  subscribeForegroundMessages,
  type WebPushStatus,
} from "@/services/webPushService";

export function useWebPush() {
  const { user, isAuthenticated } = useAuth();
  const [status, setStatus] = useState<WebPushStatus>(() => getWebPushSupportStatus());
  const [configured, setConfigured] = useState(false);

  useEffect(() => {
    void isWebPushConfiguredAsync().then(setConfigured);
  }, []);

  const refreshStatus = useCallback(() => {
    setStatus(getWebPushSupportStatus());
    void isWebPushConfiguredAsync().then(setConfigured);
  }, []);

  useEffect(() => {
    if (!isAuthenticated || !user?.id) return;
    if (!isWebPushEnabledInSettings()) return;

    let unsubscribeMessages: (() => void) | undefined;

    void registerWebPush(user.id).then((result) => {
      setStatus(result.status);
      if (!result.ok) return;

      unsubscribeMessages = subscribeForegroundMessages((payload) => {
        const title = payload.notification?.title ?? payload.data?.title ?? "DFCCIL EV-CMS";
        const body = payload.notification?.body ?? payload.data?.body ?? "";
        showLocalBrowserNotification(title, body, "/notifications");
      });
    });

    return () => {
      unsubscribeMessages?.();
    };
  }, [isAuthenticated, user?.id]);

  const enableWebPush = useCallback(async () => {
    if (!user?.id) return { ok: false, message: "Not signed in" };
    const result = await registerWebPush(user.id);
    setStatus(result.status);
    return { ok: result.ok, message: result.message };
  }, [user?.id]);

  const disableWebPush = useCallback(async () => {
    if (!user?.id) return;
    await deactivateWebPush(user.id);
    setWebPushEnabledInSettings(false);
    setStatus("disabled");
  }, [user?.id]);

  return { status, refreshStatus, enableWebPush, disableWebPush, isEnabled: isWebPushEnabledInSettings(), configured };
}
