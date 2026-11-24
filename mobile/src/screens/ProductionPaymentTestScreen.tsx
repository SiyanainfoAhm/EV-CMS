import { useCallback, useRef, useState } from "react";
import { Alert, ScrollView, Text } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as WebBrowser from "expo-web-browser";
import Header from "../components/Header";
import AppButton from "../components/AppButton";
import { backendEndpoint } from "../utils/ssoTransport";
import { getSessionMeta, requireUserId } from "../services/authService";
import type { DfccilPaymentAttempt } from "../services/dfccilPaymentService";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";

type Props = NativeStackScreenProps<RootStackParamList, "ProductionPaymentTest">;
export default function ProductionPaymentTestScreen({ navigation }: Props) {
  const [attempt, setAttempt] = useState<DfccilPaymentAttempt | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [diagnostics, setDiagnostics] = useState("");
  const [statusReady, setStatusReady] = useState(false);
  const [lastStatusRefresh, setLastStatusRefresh] = useState<Date | null>(null);
  const inFlight = useRef(false);
  const storageKey = `dfccil-real-test:${requireUserId()}`;
  const historyKey = `${storageKey}:history`;
  const call = useCallback(async (action: "create" | "retry" | "status" | "diagnose", confirmNoExistingOrder = false) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setError("");
    if (action === "status" || action === "retry") setStatusReady(false);
    if (action !== "diagnose") setLastStatusRefresh(null);
    try {
      const raw = await AsyncStorage.getItem(storageKey);
      const saved = raw ? JSON.parse(raw) as { reference: string; phase: string } : null;
      const send = async (operation: string, reference?: string) => {
        const response = await fetch(backendEndpoint("sso").replace(/\/sso$/, "/payments/production-test"), {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${getSessionMeta()?.token || ""}` },
          body: JSON.stringify({ action: operation, reference, ...(["prepare", "create", "retry"].includes(operation) ? { confirmRealPayment: true } : {}), ...(operation === "retry" && confirmNoExistingOrder ? { confirmNoExistingOrder: true } : {}) }), signal: AbortSignal.timeout(25000),
        });
        if (response.status === 404) throw new Error("The payment test API is not deployed. Merge the backend changes, enable DFCCIL_PRODUCTION_TEST_ENABLED on Vercel and redeploy, then refresh.");
        let result;
        try { result = JSON.parse(await response.text()); }
        catch { throw new Error(`Unexpected payment response (HTTP ${response.status}). Do not retry creation; refresh status.`); }
        if (result.productionTest !== true) throw new Error(result.error || "Unexpected production payment response");
        if (result.reference) {
          await AsyncStorage.setItem(storageKey, JSON.stringify({ reference: result.reference,
            phase: result.attempt?.creationState === "reserved" ? "creating" : "created" }));
          setAttempt(result.attempt);
        }
        if (!response.ok) throw new Error(result.error || "Payment request failed");
        return result;
      };
      if (action === "diagnose") {
        const result = await send("diagnose");
        const d = result.diagnostics;
        setDiagnostics(d.httpStatus ? `Gateway connectivity: HTTP ${d.httpStatus} (${d.contentType}). This read-only check used an invalid reference; it does not recover or create a payment order.` : `Gateway connectivity: ${d.category} (${d.code}). No order was created by this check.`);
        return;
      }
      if (action === "create") {
        if (saved) throw new Error("A test request already exists on this device. Refresh its status; do not create another order.");
        const prepared = await send("prepare");
        // send() persists the signed reference and creating marker BEFORE the gateway request.
        await send("create", prepared.reference);
      } else if (action === "retry") {
        if (!saved) throw new Error("No previous payment reference was found. Refresh status before starting an order.");
        const history = await AsyncStorage.getItem(historyKey);
        const prior = history ? JSON.parse(history) as Array<{ reference: string; savedAt: string }> : [];
        await AsyncStorage.setItem(historyKey, JSON.stringify([...prior, { reference: saved.reference, savedAt: new Date().toISOString() }]));
        const prepared = await send("retry", saved.reference);
        await send("create", prepared.reference);
      } else {
        const result = await send("status", saved?.reference);
        setAttempt(result.attempt);
        if (saved?.phase === "creating" && result.attempt?.creationState === "reserved") {
          throw new Error("Order creation may have been interrupted. Do not retry or clear app data. Reconcile with support before another payment.");
        }
        setLastStatusRefresh(new Date());
      }
      setStatusReady(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Payment request failed"); }
    finally { inFlight.current = false; setBusy(false); }
  }, [historyKey, storageKey]);
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
      {!attempt.verified && statusReady && (!attempt.orderId || attempt.status === "failed") ?
        <AppButton title="Try creating a new ₹1 order" disabled={busy} onPress={() => Alert.alert(
          "Create a new real ₹1 order?",
          attempt.orderId
            ? "DFCCIL reported the previous payment as failed. The app will check that order again before creating a new one."
            : "Confirm that DFCCIL has no order for the previous reference before submitting a new production order request.",
          [
            { text: "Cancel", style: "cancel" },
            { text: "Submit new order", onPress: () => { void call("retry", !attempt.orderId); } },
          ],
        )} variant="outline" /> : null}
      {!attempt.verified && !attempt.canOpenCheckout ? <Text>Refresh status before paying again. If the result is unclear, contact support with this reference. Wait 30 seconds between checks.</Text> : null}
    </> : <AppButton title="Create real ₹1 payment order" disabled={busy || !statusReady} onPress={() => Alert.alert("Real ₹1 payment", "This creates a production DFCCIL order. You will enter payment details on DFCCIL checkout. Continue?", [
      { text: "Cancel", style: "cancel" }, { text: "Create ₹1 order", onPress: () => { void call("create"); } },
    ])} />}
    {!attempt && !statusReady && !busy ? <Text>Create is unavailable until your existing payment status can be checked. Resolve the error above and tap Refresh payment status.</Text> : null}
    <AppButton title="Refresh payment status" loading={busy} onPress={() => { void call("status"); }} variant="outline" />
    {lastStatusRefresh ? <Text accessibilityLiveRegion="polite">
      Status refreshed at {lastStatusRefresh.toLocaleTimeString()}.
    </Text> : null}
    <AppButton title="Check gateway connection (no payment)" disabled={busy} onPress={() => { void call("diagnose"); }} variant="outline" />
    {diagnostics ? <Text selectable>{diagnostics}</Text> : null}
    <Text>This device retains one signed test reference for this account for up to 7 days. Do not clear app data or switch devices during the test. The payment test does not use a database ledger.</Text>
  </ScrollView>;
}
