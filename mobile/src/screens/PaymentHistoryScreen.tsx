import { useCallback, useState } from "react";
import { Text, ScrollView, StyleSheet, Alert, RefreshControl } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import Header from "../components/Header";
import AppCard from "../components/AppCard";
import AppButton from "../components/AppButton";
import StatusBadge from "../components/StatusBadge";
import * as paymentService from "../services/paymentService";
import * as receiptService from "../services/receiptService";
import { formatCurrency } from "../utils/format";
import type { Payment } from "../types";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";

type Props = NativeStackScreenProps<RootStackParamList, "PaymentHistory">;

export default function PaymentHistoryScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [error, setError] = useState("");
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await paymentService.getPaymentHistory();
      setPayments(data);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.error"));
    }
  }, [t]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const download = async (payment: Payment) => {
    if (!payment.receiptPdfUrl || !payment.receiptNumber) return;
    setDownloadingId(payment.id);
    try {
      await receiptService.downloadAndShareReceipt(payment.receiptPdfUrl, payment.receiptNumber);
      Alert.alert(t("common.success"), t("receipt.downloadSuccess"));
    } catch (e) {
      Alert.alert(t("common.error"), e instanceof Error ? e.message : t("receipt.downloadFailed"));
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.emerald} />}
    >
      <Header title={t("payment.title")} onBack={() => navigation.goBack()} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {payments.length === 0 && !error ? <Text style={styles.empty}>{t("payment.noPayments")}</Text> : null}
      {payments.map((p) => (
        <AppCard key={p.id} style={styles.card}>
          <Text style={styles.amount}>{formatCurrency(p.totalAmount)}</Text>
          <Text style={styles.meta}>{t("payment.session", { id: p.sessionId.slice(0, 8) })}</Text>
          <Text style={styles.meta}>
            {t("payment.date")}: {new Date(p.createdAt).toLocaleDateString()}
          </Text>
          <StatusBadge status={p.status} />
          {p.receiptNumber ? (
            <>
              <Text style={styles.receipt}>{t("receipt.number", { number: p.receiptNumber })}</Text>
              {p.receiptPdfUrl ? (
                <>
                  <AppButton
                    title={t("receipt.download")}
                    onPress={() => download(p)}
                    loading={downloadingId === p.id}
                    variant="outline"
                    style={styles.downloadBtn}
                  />
                  <AppButton
                    title={t("receipt.share")}
                    onPress={() => download(p)}
                    disabled={downloadingId === p.id}
                    style={styles.downloadBtn}
                  />
                </>
              ) : (
                <Text style={styles.receiptMuted}>{t("receipt.noReceipt")}</Text>
              )}
            </>
          ) : (
            <Text style={styles.receiptMuted}>{t("receipt.noReceipt")}</Text>
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
  meta: { color: colors.textMuted, marginVertical: 4, fontSize: 13 },
  receipt: { marginTop: 8, fontSize: 12, color: colors.emerald },
  receiptMuted: { marginTop: 8, fontSize: 12, color: colors.textMuted },
  downloadBtn: { marginTop: spacing.sm },
  error: { color: colors.danger, marginBottom: spacing.sm },
  empty: { textAlign: "center", color: colors.textMuted, marginTop: spacing.lg },
});
