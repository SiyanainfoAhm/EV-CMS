import { Text, StyleSheet } from "react-native";
import AppCard from "./AppCard";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";

export default function SimulationModeBadge({ compact = false }: { compact?: boolean }) {
  return (
    <AppCard style={[styles.card, compact && styles.compact]}>
      <Text style={styles.title}>Simulation Mode</Text>
      {!compact && (
        <Text style={styles.body}>
          Physical OCPP chargers are not connected. Data is generated through an OCPP-ready simulation. The same
          workflow will work with real chargers when the gateway is connected.
        </Text>
      )}
    </AppCard>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: "#fffbeb", borderColor: "#fde68a", marginBottom: spacing.sm },
  compact: { paddingVertical: spacing.sm },
  title: { fontWeight: "700", color: "#92400e", fontSize: 14 },
  body: { marginTop: 6, fontSize: 12, color: "#a16207", lineHeight: 18 },
});
