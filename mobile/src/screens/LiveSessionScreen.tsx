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

const POLL_MS = 5000;

function formatEnergy(kwh: number): string {
  return Number.isFinite(kwh) ? kwh.toFixed(2) : "0.00";
}

function formatPower(kw: number | undefined | null): string {
  if (kw == null || !Number.isFinite(kw)) return "—";
  return kw.toFixed(1);
}

function estimateLiveBill(session: ChargingSession): number | null {
  const rate = Number(session.ratePerKwhSnapshot ?? 0);
  if (!(rate > 0)) {
    if (session.amount != null && Number.isFinite(session.amount)) return Number(session.amount);
    return null;
  }
  const fee = Math.max(0, Number(session.sessionFeeSnapshot ?? 0));
  const gstPct = Math.max(0, Number(session.gstPercentSnapshot ?? 0));
  const energyAmount = session.energyKwh * rate;
  const subtotal = energyAmount + fee;
  return Math.round((subtotal * (1 + gstPct / 100)) * 100) / 100;
}

/**
 * Client backup auto-stop for time / amount session limits.
 * Does NOT require payment_status === paid (offline flow).
 */
function shouldAutoStopSession(session: ChargingSession, nowMs: number): boolean {
  const status = String(session.status || "").toLowerCase();
  if (status !== "active" && status !== "charging") return false;
  if (session.prepaidMode !== "amount" && session.prepaidMode !== "time") return false;

  const startMs = new Date(session.startTime).getTime();
  const ageMs = Number.isFinite(startMs) ? nowMs - startMs : 0;
  // Never stop in the first 20s — avoids false stops from absolute meter registers.
  if (ageMs < 20_000) return false;

  if (session.prepaidMode === "amount") {
    const cap = session.prepaidEnergyCapKwh;
    if (cap == null || !(cap > 0)) return false;
    const maxPlausible = Math.max(1, (ageMs / 3_600_000) * 400 + 1);
    if (session.energyKwh > maxPlausible) return false;
    if (session.energyKwh >= cap) return true;
  }

  if (session.prepaidMode === "time") {
    if (session.prepaidExpiresAt) {
      const exp = new Date(session.prepaidExpiresAt).getTime();
      if (Number.isFinite(exp) && exp <= nowMs) return true;
    } else if (session.prepaidDurationMinutes && session.prepaidDurationMinutes > 0) {
      if (Number.isFinite(startMs) && startMs + session.prepaidDurationMinutes * 60_000 <= nowMs) {
        return true;
      }
    }
  }
  return false;
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
  const autoStopRef = useRef(false);
  const sessionRef = useRef<ChargingSession | null>(null);

  const finishToSummary = useCallback(
    (sessionId: string) => {
      navigatingRef.current = true;
      lastSessionIdRef.current = null;
      navigation.replace("SessionSummary", { sessionId });
    },
    [navigation]
  );

  const runAutoStopIfNeeded = useCallback(
    async (s: ChargingSession, nowMs: number) => {
      if (!user || navigatingRef.current || autoStopRef.current || stopping) return;
      if (!shouldAutoStopSession(s, nowMs)) return;
      autoStopRef.current = true;
      setStopping(true);
      try {
        // stopCharging → sessionService.stopSession → OCPP RemoteStop
        const completed = await chargingService.stopCharging(s.id, user.id);
        finishToSummary(completed?.id ?? s.id);
      } catch (e) {
        autoStopRef.current = false;
        setError(e instanceof Error ? e.message : t("session.stopFailed"));
      } finally {
        setStopping(false);
      }
    },
    [user, stopping, finishToSummary, t]
  );

  const load = useCallback(async () => {
    if (!user || navigatingRef.current) return;
    try {
      const s = await chargingService.getActiveSession(user.id);
      setError("");
      if (s) {
        lastSessionIdRef.current = s.id;
        sessionRef.current = s;
        setSession(s);
        await runAutoStopIfNeeded(s, Date.now());
        return;
      }

      const endedId = lastSessionIdRef.current;
      sessionRef.current = null;
      setSession(null);
      if (endedId) {
        finishToSummary(endedId);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.error"));
    }
  }, [user, t, finishToSummary, runAutoStopIfNeeded]);

  useFocusEffect(
    useCallback(() => {
      navigatingRef.current = false;
      autoStopRef.current = false;
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

  // 1s clock + time-limit check (more accurate than 5s poll alone).
  useEffect(() => {
    if (!session) return;
    const id = setInterval(() => {
      const nowMs = Date.now();
      setNow(nowMs);
      const s = sessionRef.current;
      if (s) void runAutoStopIfNeeded(s, nowMs);
    }, 1000);
    return () => clearInterval(id);
  }, [session?.id, runAutoStopIfNeeded]);

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
          finishToSummary(completed?.id ?? session.id);
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
  const durationLive = formatSessionDuration(session.startTime, new Date(now).toISOString());
  const liveBill = estimateLiveBill(session);

  let limitLabel: string | null = null;
  if (session.prepaidMode === "amount") {
    const amountLimit = session.prepaidTotalInr ?? session.prepaidAmount;
    const parts = [
      amountLimit != null ? `Amount limit: ${formatCurrency(Number(amountLimit))}` : null,
      session.prepaidEnergyCapKwh != null
        ? `kWh ${formatEnergy(session.energyKwh)} / ${formatEnergy(session.prepaidEnergyCapKwh)}`
        : null,
    ].filter(Boolean);
    limitLabel = parts.join(" · ") || null;
  } else if (session.prepaidMode === "time") {
    const mins = session.prepaidDurationMinutes;
    if (mins) {
      const remainingMs = session.prepaidExpiresAt
        ? new Date(session.prepaidExpiresAt).getTime() - now
        : Number.isFinite(new Date(session.startTime).getTime())
          ? new Date(session.startTime).getTime() + mins * 60_000 - now
          : NaN;
      const remainingMin = Number.isFinite(remainingMs)
        ? Math.max(0, Math.ceil(remainingMs / 60_000))
        : null;
      limitLabel =
        remainingMin != null
          ? `Time limit: ${mins} min · ~${remainingMin} min left`
          : `Time limit: ${mins} min`;
    }
  }

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

        {limitLabel ? <Text style={styles.prepaidLimit}>{limitLabel}</Text> : null}

        {liveBill != null ? (
          <Text style={styles.amount}>
            {t("session.estimatedAmount")}: {formatCurrency(liveBill)}
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
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.emerald },
  liveText: { fontSize: 12, fontWeight: "700", color: colors.emerald },
  charger: { fontSize: 18, fontWeight: "800", color: colors.text },
  meta: { color: colors.textMuted, marginTop: 4 },
  socBlock: { marginTop: spacing.lg, alignItems: "center" },
  socValue: { fontSize: 36, fontWeight: "800", color: colors.emerald },
  socLabel: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  socTrack: {
    marginTop: spacing.sm,
    height: 8,
    width: "100%",
    borderRadius: 999,
    backgroundColor: "#e5e7eb",
    overflow: "hidden",
  },
  socFill: { height: "100%", backgroundColor: colors.emerald },
  stats: { flexDirection: "row", marginTop: spacing.lg, gap: spacing.sm },
  stat: { flex: 1, alignItems: "center" },
  statVal: { fontSize: 16, fontWeight: "800", color: colors.text },
  statLbl: { fontSize: 11, color: colors.textMuted, marginTop: 4, textAlign: "center" },
  prepaidLimit: {
    marginTop: spacing.md,
    fontSize: 13,
    fontWeight: "600",
    color: colors.orange,
    textAlign: "center",
  },
  amount: {
    marginTop: spacing.sm,
    fontSize: 15,
    fontWeight: "700",
    color: colors.text,
    textAlign: "center",
  },
  button: { marginTop: spacing.lg },
});
