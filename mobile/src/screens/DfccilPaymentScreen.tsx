import { useCallback, useState, useRef } from "react";
import { ScrollView, Text, StyleSheet, ActivityIndicator } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import type { RootStackParamList } from "../navigation/AppNavigator";
import Header from "../components/Header";
import AppButton from "../components/AppButton";
import AppCard from "../components/AppCard";
import {
  paymentStatus,
  openPayment,
  shareOfficialReceipt,
  clearPendingPayment,
  type DfccilPaymentAttempt,
} from "../services/dfccilPaymentService";
import { formatCurrency } from "../utils/format";
import { colors } from "../theme/colors";
type Props = NativeStackScreenProps<RootStackParamList, "DfccilPayment">;
export default function DfccilPaymentScreen({ route, navigation }: Props) {
  const sequence = useRef(0);
  const { t } = useTranslation();
  const [attempt, setAttempt] = useState<DfccilPaymentAttempt | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    const current = ++sequence.current;
    try {
      const row = await paymentStatus({ attemptId: route.params.attemptId });
      if (current !== sequence.current) return;
      setAttempt(row);
      setError("");
      if (row?.verified) await clearPendingPayment();
    } catch (e) {
      if (current === sequence.current)
        setError(e instanceof Error ? e.message : t("common.error"));
    } finally {
      if (current === sequence.current) setLoading(false);
    }
  }, [route.params.attemptId, t]);
  useFocusEffect(
    useCallback(() => {
      void load();
      let count = 0;
      const timer = setInterval(() => {
        if (++count <= 20) void load();
        else clearInterval(timer);
      }, 30000);
      return () => {
        clearInterval(timer);
        sequence.current++;
      };
    }, [load]),
  );
  const pay = async () => {
    if (!attempt) return;
    setBusy(true);
    setError("");
    try {
      await openPayment(attempt);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Header title={t("dfccil.title")} onBack={() => navigation.goBack()} />
      {loading ? <ActivityIndicator color={colors.emerald} /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {attempt ? (
        <AppCard>
          <Text style={styles.amount}>{formatCurrency(attempt.amount)}</Text>
          <Text>{t(`dfccil.status.${attempt.status}`)}</Text>
          {attempt.orderId ? (
            <Text style={styles.reference}>
              {t("dfccil.order")}: {attempt.orderId}
            </Text>
          ) : null}
          {!attempt.verified && !attempt.canOpenCheckout && attempt.status !== "failed" && attempt.status !== "cancelled" ? (
            <Text style={styles.note}>{t("dfccil.pendingHint")}</Text>
          ) : null}
        </AppCard>
      ) : null}
      {attempt?.canOpenCheckout ? (
        <AppButton title={t("dfccil.continue")} onPress={pay} loading={busy} />
      ) : null}
      <AppButton
        title={t("dfccil.refresh")}
        onPress={() => {
          void load();
        }}
        disabled={busy}
        variant="outline"
      />
      {attempt?.verified ? (
        <AppButton
          title={t("dfccil.receipt")}
          disabled={busy}
          onPress={async () => {
            setBusy(true);
            try {
              await shareOfficialReceipt(attempt.attemptId);
            } catch (e) {
              setError(e instanceof Error ? e.message : t("common.error"));
            } finally {
              setBusy(false);
            }
          }}
        />
      ) : null}
      {attempt ? (
        <AppButton
          title={t("dfccil.backToBill")}
          onPress={() =>
            navigation.navigate("SessionSummary", {
              sessionId: attempt.sessionId,
            })
          }
          variant="outline"
        />
      ) : null}
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  page: {
    padding: 20,
    gap: 18,
    backgroundColor: colors.background,
    flexGrow: 1,
  },
  amount: {
    fontSize: 26,
    fontWeight: "700",
    color: colors.text,
    marginBottom: 12,
  },
  error: { color: colors.danger },
  note: { marginTop: 12, color: colors.textMuted },
  reference: { marginTop: 12, color: colors.textMuted },
});
