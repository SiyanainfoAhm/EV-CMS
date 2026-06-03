import { useCallback, useState } from "react";
import { Text, ScrollView, StyleSheet } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import Header from "../components/Header";
import AppCard from "../components/AppCard";
import StatusBadge from "../components/StatusBadge";
import * as paymentService from "../services/paymentService";
import { formatCurrency } from "../utils/format";
import type { Payment } from "../types";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";

type Props = NativeStackScreenProps<RootStackParamList, "PaymentHistory">;

export default function PaymentHistoryScreen({ navigation }: Props) {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await paymentService.getPaymentHistory();
      setPayments(data);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load payments");
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Header title="Payment History" onBack={() => navigation.goBack()} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {payments.map((p) => (
        <AppCard key={p.id} style={styles.card}>
          <Text style={styles.amount}>{formatCurrency(p.totalAmount)}</Text>
          <Text style={styles.meta}>Session {p.sessionId.slice(0, 8)}…</Text>
          <StatusBadge status={p.status} />
          {p.receiptNumber ? (
            <Text style={styles.receipt}>
              Receipt {p.receiptNumber}
              {p.receiptPdfUrl ? " · PDF available" : " · download coming soon"}
            </Text>
          ) : (
            <Text style={styles.receiptMuted}>No receipt in EV_Receipts yet</Text>
          )}
        </AppCard>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  card: { marginBottom: spacing.sm, marginTop: spacing.xs },
  amount: { fontSize: 18, fontWeight: "700", color: colors.text },
  meta: { color: colors.textMuted, marginVertical: 6, fontSize: 13 },
  receipt: { marginTop: 8, fontSize: 12, color: colors.emerald },
  receiptMuted: { marginTop: 8, fontSize: 12, color: colors.textMuted },
  error: { color: colors.danger, marginBottom: spacing.sm },
});
