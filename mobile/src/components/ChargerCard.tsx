import { Pressable, Text, View, StyleSheet } from "react-native";
import type { Charger } from "../types";
import AppCard from "./AppCard";
import StatusBadge from "./StatusBadge";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";

interface Props {
  charger: Charger;
  onPress: () => void;
}

export default function ChargerCard({ charger, onPress }: Props) {
  const available = charger.connectors.filter((c) => c.status === "Available").length;
  return (
    <Pressable onPress={onPress}>
      <AppCard style={styles.card}>
        <View style={styles.row}>
          <View style={styles.icon}>
            <Text style={styles.iconText}>⚡</Text>
          </View>
          <View style={styles.flex}>
            <Text style={styles.name}>{charger.name}</Text>
            <Text style={styles.meta}>{charger.location}</Text>
            <Text style={styles.meta}>
              {charger.type} · {charger.maxPowerKw} kW
              {charger.distanceKm != null ? ` · ${charger.distanceKm} km` : ""}
            </Text>
          </View>
          <StatusBadge status={charger.status} />
        </View>
        <Text style={styles.connectors}>{available} connector(s) available</Text>
      </AppCard>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.sm },
  row: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  icon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.emeraldMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  iconText: { fontSize: 20 },
  flex: { flex: 1 },
  name: { fontSize: 16, fontWeight: "600", color: colors.text },
  meta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  connectors: { marginTop: spacing.sm, fontSize: 12, color: colors.emerald, fontWeight: "500" },
});
