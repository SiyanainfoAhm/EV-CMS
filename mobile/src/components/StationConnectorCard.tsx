import { Pressable, Text, View, StyleSheet } from "react-native";
import type { Charger, ChargerConnector } from "../types";
import {
  connectorStatusLabel,
  formatUptoPowerKw,
  isConnectorSelectable,
  normalizeConnectorStatus,
  plugTypeForConnector,
} from "../utils/dfccilDisplay";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";

type Props = {
  charger: Charger;
  connector: ChargerConnector;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
};

export default function StationConnectorCard({
  charger,
  connector,
  selected,
  disabled,
  onPress,
}: Props) {
  const selectable = isConnectorSelectable(connector.status) && !disabled;
  const status = normalizeConnectorStatus(connector.status);
  const plug = plugTypeForConnector(charger, connector);
  const label = connectorStatusLabel(connector.status);
  const powerLabel = formatUptoPowerKw(connector.maxPowerKw, charger.maxPowerKw || 7.4);

  const statusBg =
    status === "available" || status === "preparing"
      ? colors.emeraldMuted
      : status === "charging"
        ? colors.orangeMuted
        : "#f3f4f6";
  const statusFg =
    status === "available" || status === "preparing"
      ? colors.emerald
      : status === "charging"
        ? colors.orange
        : colors.textMuted;

  return (
    <Pressable
      onPress={selectable ? onPress : undefined}
      disabled={!selectable}
      style={[
        styles.card,
        selected && styles.cardSelected,
        !selectable && styles.cardDisabled,
      ]}
    >
      <View style={styles.row}>
        <View style={styles.flex}>
          <Text style={styles.title}>Connector {connector.connectorId}</Text>
          <Text style={styles.plug}>{plug}</Text>
        </View>
        <View style={[styles.chip, { backgroundColor: statusBg }]}>
          <Text style={[styles.chipText, { color: statusFg }]}>{label}</Text>
        </View>
      </View>
      <View style={styles.powerChip}>
        <Text style={styles.powerText}>{powerLabel}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#fafafa",
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.border,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  cardSelected: {
    borderColor: colors.emerald,
    backgroundColor: colors.emeraldMuted,
  },
  cardDisabled: {
    opacity: 0.55,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  flex: { flex: 1 },
  title: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.text,
  },
  plug: {
    marginTop: 2,
    fontSize: 13,
    color: colors.textMuted,
    fontWeight: "500",
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  chipText: {
    fontSize: 11,
    fontWeight: "700",
  },
  powerChip: {
    alignSelf: "flex-start",
    marginTop: spacing.sm,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  powerText: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.textMuted,
  },
});
