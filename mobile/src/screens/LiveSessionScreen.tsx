import { useCallback, useState } from "react";
import { View, Text, ScrollView, StyleSheet, Alert } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import Header from "../components/Header";
import AppCard from "../components/AppCard";
import AppButton from "../components/AppButton";
import { useAuth } from "../context/AuthContext";
import * as chargingService from "../services/chargingService";
import { useSupabaseRealtime } from "../hooks/useSupabaseRealtime";
import { formatCurrency } from "../utils/format";
import { confirmAction } from "../utils/confirm";
import { translateChargerName } from "../utils/translateRecord";
import type { ChargingSession } from "../types";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";

type Props = NativeStackScreenProps<RootStackParamList, "LiveSession">;

const POLL_MS = 5000;

export default function LiveSessionScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [session, setSession] = useState<ChargingSession | null>(null);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const s = await chargingService.getActiveSession(user.id);
      setSession(s);
      setError("");
      if (!s) {
        // Session may have completed remotely
        return;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.error"));
    }
  }, [user, t]);

  useFocusEffect(
    useCallback(() => {
      load();
      const id = setInterval(load, POLL_MS);
      const unsub = chargingService.subscribeActiveSession(load);
      return () => {
        clearInterval(id);
        unsub();
      };
    }, [load])
  );

  useSupabaseRealtime(load, !!user);

  const stop = () => {
    if (!session) return;
    confirmAction(
      t("session.stopCharging"),
      t("session.stopConfirmBody"),
      t("common.confirm"),
      async () => {
        setStopping(true);
        try {
          const completed = await chargingService.stopCharging(session.id, user?.id);
          navigation.replace("SessionSummary", {
            sessionId: completed?.id ?? session.id,
          });
        } catch (e) {
          Alert.alert(t("common.error"), e instanceof Error ? e.message : t("session.stopFailed"));
        } finally {
          setStopping(false);
        }
      },
      { subtitle: t("session.stopConfirm"), destructive: true }
    );
  };

  if (!session) {
    return (
      <View style={styles.root}>
        <Header title={t("session.liveTitle")} onBack={() => navigation.goBack()} />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Text style={styles.empty}>{t("session.noActive")}</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Header title={t("session.liveTitle")} onBack={() => navigation.goBack()} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <AppCard style={styles.card}>
        <Text style={styles.label}>{t("session.sessionId")}</Text>
        <Text style={styles.sessionId}>{session.id.slice(0, 8)}…</Text>
        <Text style={styles.charger}>
          {translateChargerName(t, session.chargePointId, session.chargerName)}
        </Text>
        <Text style={styles.meta}>
          {session.chargePointId} · {t("session.connector")} {session.connectorId}
        </Text>
        <View style={styles.stats}>
          <View style={styles.stat}>
            <Text style={styles.statVal}>{session.energyKwh} kWh</Text>
            <Text style={styles.statLbl}>{t("session.kwhConsumed")}</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statVal}>{session.currentPowerKw ?? "—"} kW</Text>
            <Text style={styles.statLbl}>{t("session.power")}</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statVal}>{session.soc ?? "—"}%</Text>
            <Text style={styles.statLbl}>{t("session.soc")}</Text>
          </View>
        </View>
        <Text style={styles.duration}>
          {t("session.duration")}: {session.duration}
        </Text>
        {session.amount != null ? (
          <Text style={styles.amount}>
            {t("session.estimatedAmount")}: {formatCurrency(session.amount)}
          </Text>
        ) : null}
      </AppCard>
      <AppButton
        title={t("session.stopCharging")}
        onPress={stop}
        variant="outline"
        loading={stopping}
        style={styles.button}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  empty: { textAlign: "center", marginTop: 40, color: colors.textMuted },
  error: { color: colors.danger, textAlign: "center", marginTop: spacing.md },
  card: { marginTop: spacing.sm },
  label: { fontSize: 12, color: colors.textMuted },
  sessionId: { fontWeight: "600", color: colors.text },
  charger: { fontSize: 18, fontWeight: "700", color: colors.text, marginTop: spacing.sm },
  meta: { color: colors.textMuted, marginTop: 4 },
  stats: { flexDirection: "row", justifyContent: "space-between", marginTop: spacing.lg },
  stat: { alignItems: "center", flex: 1 },
  statVal: { fontSize: 20, fontWeight: "700", color: colors.emerald },
  statLbl: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
  duration: { marginTop: spacing.md, textAlign: "center", color: colors.textMuted },
  amount: { marginTop: 8, textAlign: "center", fontWeight: "600", color: colors.text },
  button: { marginTop: spacing.sm },
});
