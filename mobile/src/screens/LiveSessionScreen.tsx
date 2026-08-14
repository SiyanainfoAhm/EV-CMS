import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { getChargerDisplayName } from "../utils/dfccilDisplay";
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

function clampPercent(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
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
  return Math.round(subtotal * (1 + gstPct / 100) * 100) / 100;
}

type SessionLimitProgress = {
  mode: "time" | "amount";
  progressPercent: number;
  limitTitle: string;
  usedLabel: string;
  limitMinutes?: number;
  elapsedMinutes?: number;
  amountLimit?: number;
  currentBill?: number;
};

/** Session-limit progress (time or amount). Not SoC / prepaid payment progress. */
function getSessionLimitProgress(
  session: ChargingSession,
  nowMs: number
): SessionLimitProgress | null {
  const mode = session.prepaidMode;
  if (mode !== "time" && mode !== "amount") return null;

  if (mode === "time") {
    const limitMinutes = Number(session.prepaidDurationMinutes ?? 0);
    if (!(limitMinutes > 0)) return null;
    const startMs = new Date(session.startTime).getTime();
    const elapsedMs = Number.isFinite(startMs) ? Math.max(0, nowMs - startMs) : 0;
    const elapsedMinutes = elapsedMs / 60_000;
    const progressPercent = clampPercent((elapsedMinutes / limitMinutes) * 100);
    const usedMins = Math.min(limitMinutes, Math.floor(elapsedMinutes));
    return {
      mode: "time",
      progressPercent,
      limitTitle: `Time limit: ${limitMinutes} min`,
      usedLabel: `${usedMins} min of ${limitMinutes} min used`,
      limitMinutes,
      elapsedMinutes,
    };
  }

  const amountLimit = Number(session.prepaidTotalInr ?? session.prepaidAmount ?? 0);
  if (!(amountLimit > 0)) return null;
  const currentBill = estimateLiveBill(session) ?? 0;
  const progressPercent = clampPercent((currentBill / amountLimit) * 100);
  return {
    mode: "amount",
    progressPercent,
    limitTitle: `Amount limit: ${formatCurrency(amountLimit)}`,
    usedLabel: `${formatCurrency(currentBill)} of ${formatCurrency(amountLimit)} used`,
    amountLimit,
    currentBill,
  };
}

/**
 * Auto-stop when session limit progress reaches 100%.
 * Also honors expire-at / energy-cap as backup for offline sessions.
 * Does NOT require payment_status === paid.
 */
function shouldAutoStopSession(
  session: ChargingSession,
  nowMs: number,
  progress: SessionLimitProgress | null
): boolean {
  const status = String(session.status || "").toLowerCase();
  if (status !== "active" && status !== "charging") return false;
  if (session.prepaidMode !== "amount" && session.prepaidMode !== "time") return false;

  const startMs = new Date(session.startTime).getTime();
  const ageMs = Number.isFinite(startMs) ? nowMs - startMs : 0;
  // Avoid false stops in the first 20s from noisy meter values.
  if (ageMs < 20_000) return false;

  if (progress && progress.progressPercent >= 100) return true;

  if (session.prepaidMode === "amount") {
    const cap = session.prepaidEnergyCapKwh;
    if (cap != null && cap > 0) {
      const maxPlausible = Math.max(1, (ageMs / 3_600_000) * 400 + 1);
      if (session.energyKwh <= maxPlausible && session.energyKwh >= cap) return true;
    }
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
  const isAutoStoppingRef = useRef(false);
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
      if (!user || navigatingRef.current || isAutoStoppingRef.current || stopping) return;
      const progress = getSessionLimitProgress(s, nowMs);
      if (!shouldAutoStopSession(s, nowMs, progress)) return;

      isAutoStoppingRef.current = true;
      setStopping(true);
      try {
        const completed = await chargingService.stopCharging(s.id, user.id);
        finishToSummary(completed?.id ?? s.id);
      } catch (e) {
        isAutoStoppingRef.current = false;
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
        if (lastSessionIdRef.current && lastSessionIdRef.current !== s.id) {
          isAutoStoppingRef.current = false;
        }
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
      // Do not clear isAutoStopping mid-flight — prevents repeated stop calls.
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

  // 1s clock + limit-limit check (more accurate than 5s poll alone).
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
    if (!session || isAutoStoppingRef.current) return;
    confirmAction(
      t("session.stopCharging"),
      t("session.stopConfirmBody"),
      t("common.confirm"),
      async () => {
        if (isAutoStoppingRef.current) return;
        isAutoStoppingRef.current = true;
        setStopping(true);
        try {
          const completed = await chargingService.stopCharging(session.id, user?.id);
          finishToSummary(completed?.id ?? session.id);
        } catch (e) {
          isAutoStoppingRef.current = false;
          Alert.alert(t("common.error"), e instanceof Error ? e.message : t("session.stopFailed"));
        } finally {
          setStopping(false);
        }
      },
      { subtitle: t("session.stopConfirm"), destructive: true }
    );
  };

  const limitProgress = useMemo(
    () => (session ? getSessionLimitProgress(session, now) : null),
    [session, now]
  );

  if (!session) {
    return (
      <View style={styles.root}>
        <Header title={t("session.liveTitle")} onBack={() => navigation.goBack()} />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Text style={styles.empty}>{t("session.noActive")}</Text>
      </View>
    );
  }

  const durationLive = formatSessionDuration(session.startTime, new Date(now).toISOString());
  const liveBill = estimateLiveBill(session);
  const progressPercent = limitProgress?.progressPercent ?? 0;

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
          {getChargerDisplayName({
            name: session.chargerName,
            chargePointId: session.chargePointId,
          })}
        </Text>
        <Text style={styles.meta}>
          {t("session.connector")} {session.connectorId}
          {session.chargePointId ? ` · ${session.chargePointId}` : ""}
        </Text>

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

        {limitProgress ? (
          <View style={styles.limitBlock}>
            <Text style={styles.limitSection}>{t("session.sessionLimit", { defaultValue: "Session limit" })}</Text>
            <Text style={styles.limitTitle}>{limitProgress.limitTitle}</Text>
            <Text style={styles.usedLabel}>{limitProgress.usedLabel}</Text>

            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
            </View>
            <Text style={styles.progressPct}>{Math.round(progressPercent)}%</Text>
          </View>
        ) : null}

        {liveBill != null ? (
          <Text style={styles.amount}>
            {t("session.estimatedAmount", { defaultValue: "Estimated bill" })}:{" "}
            {formatCurrency(liveBill)}
          </Text>
        ) : null}
      </AppCard>

      <AppButton
        title={t("session.stopCharging")}
        onPress={stop}
        variant="outline"
        loading={stopping}
        disabled={stopping}
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
  stats: { flexDirection: "row", marginTop: spacing.lg, gap: spacing.sm },
  stat: { flex: 1, alignItems: "center" },
  statVal: { fontSize: 16, fontWeight: "800", color: colors.text },
  statLbl: { fontSize: 11, color: colors.textMuted, marginTop: 4, textAlign: "center" },
  limitBlock: {
    marginTop: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  limitSection: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 6,
  },
  limitTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: colors.text,
    textAlign: "center",
  },
  usedLabel: {
    marginTop: 4,
    fontSize: 13,
    fontWeight: "600",
    color: colors.orange,
    textAlign: "center",
  },
  progressTrack: {
    marginTop: spacing.md,
    height: 10,
    width: "100%",
    borderRadius: 999,
    backgroundColor: "#e5e7eb",
    overflow: "hidden",
  },
  progressFill: { height: "100%", backgroundColor: colors.emerald, borderRadius: 999 },
  progressPct: {
    marginTop: 8,
    fontSize: 20,
    fontWeight: "800",
    color: colors.emerald,
    textAlign: "center",
  },
  amount: {
    marginTop: spacing.md,
    fontSize: 15,
    fontWeight: "700",
    color: colors.text,
    textAlign: "center",
  },
  button: { marginTop: spacing.lg },
});
