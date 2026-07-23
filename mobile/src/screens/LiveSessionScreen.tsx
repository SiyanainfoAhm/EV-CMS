import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, ScrollView, StyleSheet, Alert } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import Header from "../components/Header";
import AppCard from "../components/AppCard";
import AppButton from "../components/AppButton";
import StatusBadge from "../components/StatusBadge";
import { useAuth } from "../context/AuthContext";
import * as chargingService from "../services/chargingService";
import { useSupabaseRealtime } from "../hooks/useSupabaseRealtime";
import { formatCurrency, formatSessionDuration } from "../utils/format";
import { confirmAction } from "../utils/confirm";
import { translateChargerName } from "../utils/translateRecord";
import type { ChargingSession } from "../types";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";

type Props = NativeStackScreenProps<RootStackParamList, "LiveSession">;

const POLL_MS = 2000;

function formatEnergy(kwh: number): string {
  return Number.isFinite(kwh) ? kwh.toFixed(2) : "0.00";
}

function formatPower(kw: number | undefined | null): string {
  if (kw == null || !Number.isFinite(kw)) return "—";
  return kw.toFixed(1);
}

export default function LiveSessionScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [session, setSession] = useState<ChargingSession | null>(null);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  const lastSessionIdRef = useRef<string | null>(null);
  const navigatingRef = useRef(false);

  const load = useCallback(async () => {
    if (!user || navigatingRef.current) return;
    try {
      const s = await chargingService.getActiveSession(user.id);
      setError("");
      if (s) {
        lastSessionIdRef.current = s.id;
        setSession(s);
        return;
      }

      const endedId = lastSessionIdRef.current;
      setSession(null);
      if (endedId) {
        navigatingRef.current = true;
        lastSessionIdRef.current = null;
        navigation.replace("SessionSummary", { sessionId: endedId });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.error"));
    }
  }, [user, t, navigation]);

  useFocusEffect(
    useCallback(() => {
      navigatingRef.current = false;
      void load();
      const id = setInterval(() => void load(), POLL_MS);
      const unsub = chargingService.subscribeActiveSession(() => void load());
      return () => {
        clearInterval(id);
        unsub();
      };
    }, [load])
  );

  useSupabaseRealtime(() => void load(), !!user);

  useEffect(() => {
    if (!session) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [session?.id]);

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
          navigatingRef.current = true;
          lastSessionIdRef.current = null;
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

  const soc = session.soc != null && Number.isFinite(session.soc) ? Math.round(session.soc) : null;
  // `now` forces a re-render so duration advances every second.
  const durationLive = formatSessionDuration(session.startTime, new Date(now).toISOString());

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Header title={t("session.liveTitle")} onBack={() => navigation.goBack()} />
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <AppCard style={styles.card}>
        <View style={styles.topRow}>
          <View style={styles.livePill}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>{t("session.live", { defaultValue: "Live" })}</Text>
          </View>
          <StatusBadge status={session.status || "charging"} />
        </View>

        <Text style={styles.charger}>
          {translateChargerName(t, session.chargePointId, session.chargerName)}
        </Text>
        <Text style={styles.meta}>
          {session.chargePointId} · {t("session.connector")} {session.connectorId}
        </Text>

        <View style={styles.socBlock}>
          <Text style={styles.socValue}>{soc != null ? `${soc}%` : "—"}</Text>
          <Text style={styles.socLabel}>{t("session.soc")}</Text>
          <View style={styles.socTrack}>
            <View
              style={[
                styles.socFill,
                { width: `${soc != null ? Math.min(100, Math.max(0, soc)) : 0}%` },
              ]}
            />
          </View>
        </View>

        <View style={styles.stats}>
          <View style={styles.stat}>
            <Text style={styles.statVal}>{formatEnergy(session.energyKwh)}</Text>
            <Text style={styles.statLbl}>{t("session.kwhConsumed")}</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statVal}>{formatPower(session.currentPowerKw)}</Text>
            <Text style={styles.statLbl}>{t("session.power")} (kW)</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statVal}>{durationLive}</Text>
            <Text style={styles.statLbl}>{t("session.duration")}</Text>
          </View>
        </View>

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
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  livePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.emeraldMuted,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.emerald,
  },
  liveText: { fontSize: 12, fontWeight: "700", color: colors.emerald },
  charger: { fontSize: 18, fontWeight: "700", color: colors.text, marginTop: spacing.xs },
  meta: { color: colors.textMuted, marginTop: 4 },
  socBlock: { alignItems: "center", marginTop: spacing.lg, marginBottom: spacing.md },
  socValue: { fontSize: 40, fontWeight: "800", color: colors.emerald },
  socLabel: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  socTrack: {
    marginTop: spacing.sm,
    width: "100%",
    height: 10,
    borderRadius: 999,
    backgroundColor: "#e5e7eb",
    overflow: "hidden",
  },
  socFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: colors.emerald,
  },
  stats: { flexDirection: "row", justifyContent: "space-between", marginTop: spacing.md },
  stat: { alignItems: "center", flex: 1 },
  statVal: { fontSize: 18, fontWeight: "700", color: colors.text },
  statLbl: { fontSize: 11, color: colors.textMuted, marginTop: 4, textAlign: "center" },
  amount: { marginTop: spacing.md, textAlign: "center", fontWeight: "600", color: colors.text },
  button: { marginTop: spacing.md },
});
