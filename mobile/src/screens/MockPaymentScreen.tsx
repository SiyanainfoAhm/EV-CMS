import { useEffect, useState } from "react";
import { ScrollView, Text } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Header from "../components/Header";
import AppButton from "../components/AppButton";
import { backendEndpoint } from "../utils/ssoTransport";
import { getSessionMeta, requireUserId } from "../services/authService";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";

type Attempt = { attemptId: string; amount: number; status: string; verified: boolean };
type Props = NativeStackScreenProps<RootStackParamList, "MockPayment">;
export default function MockPaymentScreen({ navigation }: Props) {
  const [reference, setReference] = useState("");
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const storageKey = `payment-mock:${requireUserId()}`;
  const call = async (action: string, ref = reference, outcome?: string) => {
    setBusy(true); setError("");
    try {
      const response = await fetch(backendEndpoint("sso").replace(/\/sso$/, "/payments/mock"), {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${getSessionMeta()?.token || ""}` },
        body: JSON.stringify({ action, reference: ref, outcome }), signal: AbortSignal.timeout(20000),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Mock request failed");
      if (result.mock !== true) throw new Error("Unexpected mock response");
      await AsyncStorage.setItem(storageKey, result.reference);
      setReference(result.reference); setAttempt(result.attempt);
    } catch (e) { setError(e instanceof Error ? e.message : "Mock request failed"); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    void (async () => {
      try {
        const saved = await AsyncStorage.getItem(storageKey);
        if (saved) await call("status", saved);
      } catch { setError("Could not restore mock order."); }
      finally { setBusy(false); }
    })();
  }, [storageKey]);
  return <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
    <Header title="Mock payment test" onBack={() => navigation.goBack()} />
    <Text>TEST ONLY · No money moves. No charging bill is required. This simulates gateway results through the backend; it does not contact DFCCIL checkout.</Text>
    {error ? <Text accessibilityRole="alert" style={{ color: "#b91c1c" }}>{error}</Text> : null}
    {attempt ? <>
      <Text selectable>{attempt.attemptId}</Text>
      <Text>₹{attempt.amount.toFixed(2)} · {attempt.status}</Text>
      {attempt.verified ? <Text>Mock success verified by the mock backend. This is not a payment receipt.</Text> : null}
      {attempt.status === "pending" ? (["paid", "failed", "cancelled", "pending"] as const).map(outcome =>
        <AppButton key={outcome} title={`Simulate ${outcome === "paid" ? "success" : outcome}`} disabled={busy}
          onPress={() => { void call("resolve", reference, outcome); }} variant="outline" />) : null}
      <AppButton title="Refresh status" disabled={busy} onPress={() => { void call("status"); }} />
    </> : null}
    <AppButton title="Create new mock order (₹1)" loading={busy} onPress={() => { void call("create"); }} />
  </ScrollView>;
}
