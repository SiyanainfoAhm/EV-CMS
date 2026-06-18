import { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, Alert, View } from "react-native";
import { useTranslation } from "react-i18next";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import Header from "../components/Header";
import AppCard from "../components/AppCard";
import AppButton from "../components/AppButton";
import StatusBadge from "../components/StatusBadge";
import * as sessionService from "../services/sessionService";
import * as receiptService from "../services/receiptService";
import * as paymentService from "../services/paymentService";
import { formatCurrency } from "../utils/format";
import { translateChargerName } from "../utils/translateRecord";
import type { ChargingSession, Receipt } from "../types";
import type { SessionPaymentSummary } from "../services/paymentService";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";
import { TOPUP_MIN_AMOUNT } from "../config/walletConfig";

type Props = NativeStackScreenProps<RootStackParamList, "SessionSummary">;

function isPaymentPaid(status: string): boolean {
  return status === "success" || status === "paid";
}

export default function SessionSummaryScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const { sessionId, focusPayment } = route.params;
  const [session, setSession] = useState<ChargingSession | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [payment, setPayment] = useState<SessionPaymentSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const s = await sessionService.getSessionById(sessionId);
      setSession(s);
      if (s) {
        const [r, p] = await Promise.all([
          receiptService.getReceiptBySessionId(sessionId),
          paymentService.getSessionPayment(sessionId),
        ]);
        setReceipt(r);
        setPayment(p);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.error"));
    } finally {
      setLoading(false);
    }
  }, [sessionId, t]);

  useEffect(() => {
    load();
  }, [load]);

  const payFromWallet = async () => {
    if (!payment || payment.amountDue <= 0) return;
    setBusy(true);
    try {
      const result = await paymentService.paySessionFromWallet(sessionId);
      setPayment(result);
      Alert.alert(t("common.success"), t("session.paymentSuccess"));
      await load();
    } catch (e) {
      const code = e instanceof Error ? e.message : "UNKNOWN";
      if (code === "WALLET_LOW_BALANCE") {
        const shortfall = Math.max(
          TOPUP_MIN_AMOUNT,
          Math.ceil((payment.amountDue - payment.walletBalance) / 100) * 100
        );
        Alert.alert(t("common.error"), t("session.insufficientWallet"), [
          { text: t("common.cancel"), style: "cancel" },
          {
            text: t("wallet.topUp"),
            onPress: () =>
              navigation.navigate("Topup", { suggestedAmount: shortfall, returnSessionId: sessionId }),
          },
        ]);
        return;
      }
      if (code === "WALLET_BLOCKED") {
        Alert.alert(t("common.error"), t("wallet.walletBlocked"));
        return;
      }
      if (code === "PAYMENT_NOT_FOUND") {
        Alert.alert(t("common.error"), t("session.paymentNotFound"));
        return;
      }
      Alert.alert(t("common.error"), e instanceof Error ? e.message : t("session.paymentFailed"));
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    if (!receipt?.pdfUrl) return;
    setBusy(true);
    try {
      await receiptService.downloadAndShareReceipt(receipt.pdfUrl, receipt.receiptNumber);
      Alert.alert(t("common.success"), t("receipt.downloadSuccess"));
    } catch (e) {
      Alert.alert(t("common.error"), e instanceof Error ? e.message : t("receipt.downloadFailed"));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.root}>
        <Header title={t("session.summary")} onBack={() => navigation.goBack()} />
        <Text style={styles.muted}>{t("common.loading")}</Text>
      </View>
    );
  }

  if (!session) {
    return (
      <View style={styles.root}>
        <Header title={t("session.summary")} onBack={() => navigation.goBack()} />
        <Text style={styles.error}>{error || t("common.noData")}</Text>
      </View>
    );
  }

  const paymentDue = payment && payment.amountDue > 0 && !isPaymentPaid(payment.status);
  const canPayFromWallet = paymentDue && payment.walletBalance >= payment.amountDue;

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Header title={t("session.summary")} subtitle={t("session.completed")} onBack={() => navigation.goBack()} />
      <AppCard>
        <Text style={styles.label}>{t("session.sessionId")}</Text>
        <Text style={styles.value}>{session.id.slice(0, 8)}…</Text>
        <Text style={styles.charger}>
          {translateChargerName(t, session.chargePointId, session.chargerName)}
        </Text>
        <Text style={styles.meta}>
          {session.chargePointId} · {t("session.connector")} {session.connectorId}
        </Text>
        <View style={styles.row}>
          <View style={styles.stat}>
            <Text style={styles.statLbl}>{t("session.kwhConsumed")}</Text>
            <Text style={styles.statVal}>{session.energyKwh} kWh</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statLbl}>{t("session.duration")}</Text>
            <Text style={styles.statVal}>{session.duration}</Text>
          </View>
        </View>
        {session.amount != null ? (
          <Text style={styles.amount}>
            {t("session.estimatedAmount")}: {formatCurrency(session.amount)}
          </Text>
        ) : null}
        <StatusBadge status={session.status} />
      </AppCard>

      {payment ? (
        <AppCard
          style={[
            styles.paymentCard,
            focusPayment && paymentDue ? styles.paymentCardHighlight : null,
          ]}
        >
          <View>
            <Text style={styles.paymentTitle}>{t("session.paymentDueTitle")}</Text>
            <View style={styles.paymentRow}>
              <Text style={styles.label}>{t("payment.amount")}</Text>
              <Text style={styles.paymentValue}>{formatCurrency(payment.amount)}</Text>
            </View>
            <View style={styles.paymentRow}>
              <Text style={styles.label}>{t("session.gst")}</Text>
              <Text style={styles.paymentValue}>{formatCurrency(payment.gstAmount)}</Text>
            </View>
            <View style={styles.paymentRow}>
              <Text style={styles.label}>{t("session.totalDue")}</Text>
              <Text style={styles.totalDue}>{formatCurrency(payment.totalAmount)}</Text>
            </View>
            <View style={styles.paymentRow}>
              <Text style={styles.label}>{t("session.paymentStatus")}</Text>
              <StatusBadge status={payment.status} />
            </View>
            <View style={styles.paymentRow}>
              <Text style={styles.label}>{t("wallet.usableBalance")}</Text>
              <Text style={styles.paymentValue}>{formatCurrency(payment.walletBalance)}</Text>
            </View>

            {paymentDue ? (
              <>
                <Text style={styles.paymentHint}>{t("session.paymentDueHint")}</Text>
                <AppButton
                  title={t("session.payFromWallet")}
                  onPress={payFromWallet}
                  loading={busy}
                  style={styles.btn}
                />
                {!canPayFromWallet ? (
                  <AppButton
                    title={t("session.topUpToPay")}
                    variant="outline"
                    onPress={() =>
                      navigation.navigate("Topup", {
                        suggestedAmount: Math.max(
                          TOPUP_MIN_AMOUNT,
                          Math.ceil((payment.amountDue - payment.walletBalance) / 100) * 100
                        ),
                        returnSessionId: sessionId,
                      })
                    }
                    style={styles.btn}
                  />
                ) : null}
              </>
            ) : (
              <Text style={styles.paidText}>{t("session.paymentCompleted")}</Text>
            )}
          </View>
        </AppCard>
      ) : (
        <Text style={styles.muted}>{t("session.paymentNotFound")}</Text>
      )}

      {receipt?.pdfUrl ? (
        <>
          <AppButton title={t("receipt.download")} onPress={download} loading={busy} style={styles.btn} />
          <AppButton
            title={t("receipt.share")}
            onPress={download}
            variant="outline"
            disabled={busy}
            style={styles.btn}
          />
        </>
      ) : paymentDue ? null : (
        <Text style={styles.muted}>{t("receipt.noReceipt")}</Text>
      )}

      <AppButton
        title={t("session.history")}
        variant="outline"
        onPress={() => navigation.navigate("SessionHistory")}
        style={styles.btn}
      />
      <AppButton title={t("dashboard.title")} onPress={() => navigation.navigate("Home")} style={styles.btn} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  label: { color: colors.textMuted, fontSize: 12 },
  value: { fontWeight: "600", color: colors.text, marginTop: 4 },
  charger: { fontSize: 18, fontWeight: "700", color: colors.text, marginTop: spacing.md },
  meta: { color: colors.textMuted, marginTop: 4 },
  row: { flexDirection: "row", marginTop: spacing.lg, gap: spacing.lg },
  stat: { flex: 1 },
  statLbl: { fontSize: 12, color: colors.textMuted },
  statVal: { fontSize: 18, fontWeight: "700", color: colors.emerald, marginTop: 4 },
  amount: { marginTop: spacing.md, fontWeight: "600", color: colors.text },
  paymentCard: { marginTop: spacing.sm, borderLeftWidth: 3, borderLeftColor: colors.emerald },
  paymentCardHighlight: { borderLeftColor: colors.danger, backgroundColor: colors.emeraldMuted },
  paymentTitle: { fontSize: 16, fontWeight: "700", color: colors.text, marginBottom: spacing.sm },
  paymentRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 8,
  },
  paymentValue: { fontWeight: "600", color: colors.text },
  totalDue: { fontSize: 20, fontWeight: "800", color: colors.danger },
  paymentHint: { marginTop: spacing.md, color: colors.textMuted, fontSize: 13, lineHeight: 20 },
  paidText: { marginTop: spacing.md, color: colors.emerald, fontWeight: "600" },
  btn: { marginTop: spacing.sm },
  muted: { color: colors.textMuted, textAlign: "center", marginTop: spacing.lg },
  error: { color: colors.danger, textAlign: "center", marginTop: spacing.lg },
});
