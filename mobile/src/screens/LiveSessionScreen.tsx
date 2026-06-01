import { useEffect, useState } from "react";
import { View, Text, ScrollView, StyleSheet } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import Header from "../components/Header";
import AppCard from "../components/AppCard";
import AppButton from "../components/AppButton";
import * as sessionService from "../services/sessionService";
import type { ChargingSession } from "../types";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";

type Props = NativeStackScreenProps<RootStackParamList, "LiveSession">;

export default function LiveSessionScreen({ navigation }: Props) {
  const [session, setSession] = useState<ChargingSession | null>(null);

  useEffect(() => {
    sessionService.getActiveSession().then(setSession);
  }, []);

  const stop = async () => {
    if (session) await sessionService.stopSession(session.id);
    navigation.navigate("Home");
  };

  if (!session) {
    return (
      <View style={styles.root}>
        <Header title="Live Session" onBack={() => navigation.goBack()} />
        <Text style={styles.empty}>No active session</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Header title="Live Session" onBack={() => navigation.goBack()} />
      <AppCard>
        <Text style={styles.charger}>{session.chargerName}</Text>
        <Text style={styles.meta}>{session.chargePointId} · Gun {session.connectorId}</Text>
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
      </AppCard>
      <AppButton title="Stop Charging" onPress={stop} variant="outline" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  empty: { textAlign: "center", marginTop: 40, color: colors.textMuted },
  charger: { fontSize: 18, fontWeight: "700", color: colors.text },
  meta: { color: colors.textMuted, marginTop: 4 },
  stats: { flexDirection: "row", justifyContent: "space-between", marginTop: spacing.lg },
  stat: { alignItems: "center", flex: 1 },
  statVal: { fontSize: 20, fontWeight: "700", color: colors.emerald },
  statLbl: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
  duration: { marginTop: spacing.md, textAlign: "center", color: colors.textMuted },
});
