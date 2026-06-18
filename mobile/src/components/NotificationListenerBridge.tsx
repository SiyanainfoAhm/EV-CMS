import { useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { setupNotificationListeners } from "../services/notificationService";
import { navigateFromNotificationData } from "../navigation/navigationRef";

/** Registers Expo push tap handlers while user is authenticated. */
export default function NotificationListenerBridge() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user?.id) return;
    return setupNotificationListeners((data) => {
      navigateFromNotificationData(data as Record<string, unknown>);
    });
  }, [user?.id]);

  return null;
}
