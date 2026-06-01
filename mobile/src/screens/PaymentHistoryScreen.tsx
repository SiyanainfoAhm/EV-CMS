import { useEffect, useState } from "react";
import { Text, ScrollView, StyleSheet } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import Header from "../components/Header";
import AppCard from "../components/AppCard";
import StatusBadge from "../components/StatusBadge";
import * as paymentService from "../services/paymentService";
import type { Payment } from "../types";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";

type Props = NativeStackScreenProps<RootStackParamList, "PaymentHistory">;

export default function PaymentHistoryScreen({ navigation }: Props) {
  const [payments, setPayments] = useState<Payment[]>([]);

  useEffect(() => {
    paymentService.getPaymentHistory().then(setPayments);
  }, []);

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Header title="Payment History" onBack={() => navigation.goBack()} />
      {payments.map((p) => (
        <AppCard key={p.id} style={styles.card}>
          <Text style={styles.amount}>₹{p.totalAmount.toFixed(2)}</Text>
          <Text style={styles.meta}>Session {p.sessionId}</Text>
          <StatusBadge status={p.status} />
        </AppCard>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  card: { marginBottom: spacing.sm },
  amount: { fontSize: 18, fontWeight: "700", color: colors.text },
  meta: { color: colors.textMuted, marginVertical: 6, fontSize: 13 },
});
