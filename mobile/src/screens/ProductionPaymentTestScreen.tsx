import { useCallback, useState } from "react";
import { Alert, ScrollView, Text } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import * as WebBrowser from "expo-web-browser";
import Header from "../components/Header";
import AppButton from "../components/AppButton";
import { backendEndpoint } from "../utils/ssoTransport";
import { getSessionMeta } from "../services/authService";
import type { DfccilPaymentAttempt } from "../services/dfccilPaymentService";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";

type Props = NativeStackScreenProps<RootStackParamList, "ProductionPaymentTest">;
export default function ProductionPaymentTestScreen({ navigation }: Props) {
  const [attempt, setAttempt] = useState<DfccilPaymentAttempt | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [statusReady, setStatusReady] = useState(false);
  const call = useCallback(async (action: "create" | "status") => {
    setBusy(true); setError("");
    if (action === "status") setStatusReady(false);
    try {
      const response = await fetch(backendEndpoint("sso").replace(/\/sso$/, "/payments/production-test"), {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${getSessionMeta()?.token || ""}` },
        body: JSON.stringify({ action, ...(action === "create" ? { confirmRealPayment: true } : {}) }), signal: AbortSignal.timeout(25000),
      });
      if (response.status === 404) {
        throw new Error("The real-payment test API is not deployed yet. Merge the backend branch, apply the test-payment database migration, enable DFCCIL_PRODUCTION_TEST_ENABLED in Vercel, and redeploy. Then tap Refresh payment status.");
      }
      const text = await response.text();
      let result;
      try { result = JSON.parse(text); }
      catch { throw new Error(`The payment server returned an unexpected response (HTTP ${response.status}). Tap Refresh payment status before trying again.`); }
      if (!response.ok) throw new Error(result.error || "Payment request failed");
      if (result.productionTest !== true) throw new Error("Unexpected production payment response");
      setAttempt(result.attempt);
      setStatusReady(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Payment request failed"); }
    finally { setBusy(false); }
  }, []);
  useFocusEffect(useCallback(() => { void call("status"); }, [call]));
  const checkout = async () => {
    if (!attempt?.canOpenCheckout || !attempt.orderId) return;
    const expected = `https://epay.dfccil.com/Payment/Pay/${encodeURIComponent(attempt.orderId)}`;
    if (attempt.checkoutUrl !== expected) { setError("Unexpected checkout URL"); return; }
    setBusy(true); setError("");
    try {
      await WebBrowser.openAuthSessionAsync(expected, "in.dfccil.evcms://payments/production-test/return");
      await call("status");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not open checkout"); }
    finally { setBusy(false); }
  };
  return <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
    <Header title="DFCCIL real payment test" onBack={() => navigation.goBack()} />
    <Text>Real production payment · ₹1. This opens DFCCIL checkout and can charge your selected payment method. It is separate from charging bills. No automatic refund is provided.</Text>
    {error ? <Text accessibilityRole="alert" style={{ color: "#b91c1c" }}>{error}</Text> : null}
    {attempt ? <>
      <Text selectable>Reference: {attempt.orderId || attempt.attemptId}</Text>
      <Text>₹{attempt.amount.toFixed(2)} · {attempt.status}</Text>
      {attempt.verified ? <Text>Payment confirmed by DFCCIL's server-side Status API.</Text> : null}
      {attempt.canOpenCheckout ? <AppButton title="Open DFCCIL checkout · ₹1 real payment" disabled={busy} onPress={() => { void checkout(); }} /> : null}
      {!attempt.verified && !attempt.canOpenCheckout ? <Text>Refresh status before paying again. If the result is unclear, contact support with this reference. Checks are limited to once every 30 seconds.</Text> : null}
    </> : <AppButton title="Create real ₹1 payment order" disabled={busy || !statusReady} onPress={() => Alert.alert("Real ₹1 payment", "This creates a production DFCCIL order. You will enter payment details on DFCCIL checkout. Continue?", [
      { text: "Cancel", style: "cancel" }, { text: "Create ₹1 order", onPress: () => { void call("create"); } },
    ])} />}
    {!attempt && !statusReady && !busy ? <Text>Create is unavailable until your existing payment status can be checked. Resolve the error above and tap Refresh payment status.</Text> : null}
    <AppButton title="Refresh payment status" loading={busy} onPress={() => { void call("status"); }} variant="outline" />
    <Text>Only one production test order is allowed per account. Your order is restored from the server when you reopen this screen.</Text>
  </ScrollView>;
}
