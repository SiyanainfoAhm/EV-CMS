import { useCallback, useEffect, useMemo, useState } from "react";
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
import {
  getCompletionBannerState,
  offlineCollectionStatusLabel,
} from "../utils/sessionCompletion";
import { formatCurrency } from "../utils/format";
import { getChargerDisplayName } from "../utils/dfccilDisplay";
import type { ChargingSession, Receipt } from "../types";
import type { SessionPaymentSummary } from "../services/paymentService";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";

type Props = NativeStackScreenProps<RootStackParamList, "SessionSummary">;

function formatWhen(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

export default function SessionSummaryScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const { sessionId } = route.params;
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
          receiptService.getReceiptBySessionId(sessionId).catch(() => null),
          paymentService.getSessionPayment(sessionId).catch(() => null),
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

  const banner = useMemo(() => getCompletionBannerState(session, payment), [session, payment]);
  const collectionStatus = useMemo(
    () => offlineCollectionStatusLabel(session, payment),
    [session, payment]
  );

  const download = async () => {
    if (!receipt?.receiptNumber) return;
    setBusy(true);
    try {
      await receiptService.downloadReceipt({
        paymentId: receipt.paymentId,
        receiptNumber: receipt.receiptNumber,
        pdfUrl: receipt.pdfUrl,
      });
      Alert.alert(t("common.success"), t("receipt.downloadSuccess"));
    } catch (e) {
      Alert.alert(t("common.error"), e instanceof Error ? e.message : t("receipt.downloadFailed"));
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    if (!receipt?.receiptNumber) return;
    setBusy(true);
    try {
      await receiptService.shareReceipt({
        paymentId: receipt.paymentId,
        receiptNumber: receipt.receiptNumber,
        pdfUrl: receipt.pdfUrl,
      });
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

  const displayName = getChargerDisplayName({
    name: session.chargerName,
    chargePointId: session.chargePointId,
  });
  const billAmount =
    payment?.totalAmount ??
    session.amount ??
    session.prepaidTotalInr ??
    session.prepaidAmount ??
    session.amountDue ??
    null;
  const energyAmount = payment?.amount ?? null;
  const gstAmount = payment?.gstAmount ?? null;
  const receiptNumber =
    receipt?.receiptNumber ??
    `RCP-${session.id.replace(/-/g, "").slice(0, 10).toUpperCase()}`;

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Header
        title={t("session.billTitle", { defaultValue: "Charging Bill" })}
        subtitle={t(banner.messageKey)}
        onBack={() => navigation.goBack()}
      />

      <AppCard style={styles.banner}>
        <Text style={styles.bannerTitle}>{t(banner.titleKey)}</Text>
        <Text style={styles.bannerMessage}>{t(banner.messageKey)}</Text>
        <View style={styles.badgeWrap}>
          <Text style={styles.badge}>{t("session.paymentModeOffline")}</Text>
        </View>
      </AppCard>

      <AppCard>
        <Text style={styles.sectionTitle}>{t("session.receiptTitle", { defaultValue: "Receipt" })}</Text>
        <Text style={styles.charger}>{displayName}</Text>
        <Text style={styles.meta}>
          {session.chargePointId} · {t("session.connector")} {session.connectorId}
        </Text>

        <View style={styles.paymentRow}>
          <Text style={styles.label}>{t("session.sessionStart")}</Text>
          <Text style={styles.paymentValue}>{formatWhen(session.startTime)}</Text>
        </View>
        <View style={styles.paymentRow}>
          <Text style={styles.label}>{t("session.sessionEnd")}</Text>
          <Text style={styles.paymentValue}>{formatWhen(session.endTime)}</Text>
        </View>
        <View style={styles.paymentRow}>
          <Text style={styles.label}>{t("session.duration")}</Text>
          <Text style={styles.paymentValue}>{session.duration}</Text>
        </View>
        <View style={styles.paymentRow}>
          <Text style={styles.label}>{t("session.energyConsumed")}</Text>
          <Text style={styles.paymentValue}>{Number(session.energyKwh).toFixed(3)} kWh</Text>
        </View>
        {session.prepaidMode ? (
          <View style={styles.paymentRow}>
            <Text style={styles.label}>{t("session.limitSelected")}</Text>
            <Text style={styles.paymentValue}>
              {session.prepaidMode === "time"
                ? `${session.prepaidDurationMinutes ?? "—"} min`
                : formatCurrency(session.prepaidTotalInr ?? session.prepaidAmount ?? 0)}
            </Text>
          </View>
        ) : null}
      </AppCard>

      <AppCard style={styles.billCard}>
        <Text style={styles.sectionTitle}>{t("session.billTitle")}</Text>
        {energyAmount != null ? (
          <View style={styles.paymentRow}>
            <Text style={styles.label}>{t("payment.amount")}</Text>
            <Text style={styles.paymentValue}>{formatCurrency(energyAmount)}</Text>
          </View>
        ) : null}
        {gstAmount != null && gstAmount > 0 ? (
          <View style={styles.paymentRow}>
            <Text style={styles.label}>{t("session.gst")}</Text>
            <Text style={styles.paymentValue}>{formatCurrency(gstAmount)}</Text>
          </View>
        ) : null}
        <View style={styles.paymentRow}>
          <Text style={styles.label}>{t("session.totalBill")}</Text>
          <Text style={styles.totalDue}>
            {billAmount != null ? formatCurrency(billAmount) : "—"}
          </Text>
        </View>
        <View style={styles.paymentRow}>
          <Text style={styles.label}>{t("session.paymentMode")}</Text>
          <Text style={styles.paymentValue}>{t("session.paymentModeOffline")}</Text>
        </View>
        <View style={styles.paymentRow}>
          <Text style={styles.label}>{t("session.collectionStatus")}</Text>
          <StatusBadge status={collectionStatus} />
        </View>
        <View style={styles.paymentRow}>
          <Text style={styles.label}>{t("session.receiptNumber")}</Text>
          <Text style={styles.txn}>{receiptNumber}</Text>
        </View>
        <Text style={styles.hint}>{t("session.paymentDueHint")}</Text>
      </AppCard>

      {receipt?.receiptNumber ? (
        <>
          <AppButton title={t("session.viewReceipt")} onPress={download} loading={busy} style={styles.btn} />
          <AppButton
            title={t("receipt.share")}
            onPress={share}
            variant="outline"
            disabled={busy}
            style={styles.btn}
          />
        </>
      ) : null}

      <AppButton
        title={t("common.done")}
        onPress={() => navigation.navigate("Home")}
        style={styles.btn}
      />
      <AppButton
        title={t("session.history")}
        variant="outline"
        onPress={() => navigation.navigate("SessionHistory")}
        style={styles.btn}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  banner: {
    borderLeftWidth: 3,
    borderLeftColor: colors.orange,
    backgroundColor: colors.orangeMuted,
    marginBottom: spacing.sm,
  },
  bannerTitle: { fontSize: 18, fontWeight: "800", color: colors.text },
  bannerMessage: { marginTop: 6, fontSize: 13, color: colors.textMuted, lineHeight: 18 },
  badgeWrap: { marginTop: spacing.sm, alignSelf: "flex-start" },
  badge: {
    backgroundColor: colors.orange,
    color: "#fff",
    overflow: "hidden",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    fontSize: 12,
    fontWeight: "700",
  },
  sectionTitle: { fontSize: 15, fontWeight: "700", color: colors.text, marginBottom: spacing.sm },
  label: { color: colors.textMuted, fontSize: 12, flex: 1 },
  charger: { fontSize: 18, fontWeight: "800", color: colors.text },
  meta: { color: colors.textMuted, marginTop: 4, marginBottom: spacing.sm },
  billCard: { marginTop: spacing.sm, borderLeftWidth: 3, borderLeftColor: colors.emerald },
  paymentRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 8,
    gap: spacing.sm,
  },
  paymentValue: { fontWeight: "600", color: colors.text, textAlign: "right", flexShrink: 1 },
  totalDue: { fontSize: 20, fontWeight: "800", color: colors.emerald },
  txn: { fontWeight: "600", color: colors.textMuted, fontSize: 12, maxWidth: "55%", textAlign: "right" },
  hint: { marginTop: spacing.md, color: colors.textMuted, fontSize: 13, lineHeight: 20 },
  btn: { marginTop: spacing.sm },
  muted: { color: colors.textMuted, textAlign: "center", marginTop: spacing.lg },
  error: { color: colors.danger, textAlign: "center", marginTop: spacing.lg },
});
