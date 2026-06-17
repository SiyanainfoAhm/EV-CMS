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
import { formatCurrency } from "../utils/format";
import { translateChargerName } from "../utils/translateRecord";
import type { ChargingSession, Receipt } from "../types";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";

type Props = NativeStackScreenProps<RootStackParamList, "SessionSummary">;

export default function SessionSummaryScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const { sessionId } = route.params;
  const [session, setSession] = useState<ChargingSession | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
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
        const r = await receiptService.getReceiptBySessionId(sessionId);
        setReceipt(r);
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
      ) : (
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
  btn: { marginTop: spacing.sm },
  muted: { color: colors.textMuted, textAlign: "center", marginTop: spacing.lg },
  error: { color: colors.danger, textAlign: "center", marginTop: spacing.lg },
});
