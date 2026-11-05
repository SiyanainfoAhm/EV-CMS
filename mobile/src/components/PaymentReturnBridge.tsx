import { useEffect } from "react";
import { Linking } from "react-native";
import { navigationRef } from "../navigation/navigationRef";
import {
  returnedAttempt,
  paymentStatus,
  pendingPayment,
  clearPendingPayment,
} from "../services/dfccilPaymentService";
import { dfccilPaymentsEnabled } from "../config/dfccilPaymentConfig";
// A link is only a navigation hint; the authenticated backend enforces ownership and state.
export default function PaymentReturnBridge() {
  useEffect(() => {
    if (!dfccilPaymentsEnabled) return;
    let stopped = false;
    const open = async (id: string | null) => {
      if (!id) return;
      try {
        const row = await paymentStatus({ attemptId: id });
        if (stopped || !row) return;
        let attempts = 0;
        const navigate = () => {
          if (stopped) return;
          if (navigationRef.isReady())
            navigationRef.navigate("DfccilPayment", {
              attemptId: row.attemptId,
            });
          else if (++attempts < 20) setTimeout(navigate, 150);
        };
        navigate();
      } catch {
        await clearPendingPayment();
      }
    };
    void Linking.getInitialURL().then(async (url) => {
      await open(
        (url ? returnedAttempt(url) : null) || (await pendingPayment()),
      );
    });
    const sub = Linking.addEventListener("url", (event) => {
      void open(returnedAttempt(event.url));
    });
    return () => {
      stopped = true;
      sub.remove();
    };
  }, []);
  return null;
}
