import { useCallback, useState } from "react";
import { View, Text, ScrollView, StyleSheet, Alert } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import Header from "../components/Header";
import AppCard from "../components/AppCard";
import AppButton from "../components/AppButton";
import { useAuth } from "../context/AuthContext";
import * as sessionService from "../services/sessionService";
import { formatCurrency } from "../utils/format";
import type { ChargingSession } from "../types";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";

type Props = NativeStackScreenProps<RootStackParamList, "LiveSession">;

const POLL_MS = 10000;

export default function LiveSessionScreen({ navigation }: Props) {
  const { user } = useAuth();
  const [session, setSession] = useState<ChargingSession | null>(null);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const s = await sessionService.getActiveSession(user.id);
      setSession(s);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load session");
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      load();
      const id = setInterval(load, POLL_MS);
      return () => clearInterval(id);
    }, [load])
  );

  const stop = async () => {
    if (!session) return;
    setStopping(true);
    try {
      await sessionService.stopSession(session.id);
      navigation.navigate("Home");
    } catch (e) {
      Alert.alert("Stop failed", e instanceof Error ? e.message : "Could not stop session");
    } finally {
      setStopping(false);
    }
  };

  if (!session) {
    return (
      <View style={styles.root}>
        <Header title="Live Session" onBack={() => navigation.goBack()} />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Text style={styles.empty}>No active session for your account</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Header title="Live Session" onBack={() => navigation.goBack()} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <AppCard style={styles.card}>
        <Text style={styles.charger}>{session.chargerName}</Text>
        <Text style={styles.meta}>
          {session.chargePointId} · Gun {session.connectorId}
        </Text>
        <View style={styles.stats}>
          <View style={styles.stat}>
            <Text style={styles.statVal}>{session.energyKwh} kWh</Text>
            <Text style={styles.statLbl}>Energy</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statVal}>{session.currentPowerKw ?? "—"} kW</Text>
            <Text style={styles.statLbl}>Power</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statVal}>{session.soc ?? "—"}%</Text>
            <Text style={styles.statLbl}>SoC</Text>
          </View>
        </View>
        <Text style={styles.duration}>Duration: {session.duration}</Text>
        {session.amount != null ? (
          <Text style={styles.amount}>Est. cost: {formatCurrency(session.amount)}</Text>
        ) : null}
      </AppCard>
      <AppButton title="Stop Charging" onPress={stop} variant="outline" loading={stopping} style={styles.button} />
      <Text style={styles.pollNote}>Refreshes every {POLL_MS / 1000}s from EV_ChargingSessions</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  empty: { textAlign: "center", marginTop: 40, color: colors.textMuted },
  error: { color: colors.danger, textAlign: "center", marginTop: spacing.md },
  card: { marginTop: spacing.sm },
  charger: { fontSize: 18, fontWeight: "700", color: colors.text },
  meta: { color: colors.textMuted, marginTop: 4 },
  stats: { flexDirection: "row", justifyContent: "space-between", marginTop: spacing.lg },
  stat: { alignItems: "center", flex: 1 },
  statVal: { fontSize: 20, fontWeight: "700", color: colors.emerald },
  statLbl: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
  duration: { marginTop: spacing.md, textAlign: "center", color: colors.textMuted },
  amount: { marginTop: 8, textAlign: "center", fontWeight: "600", color: colors.text },
  button: { marginTop: spacing.sm },
  pollNote: { fontSize: 11, color: colors.textMuted, textAlign: "center", marginTop: spacing.md },
});
