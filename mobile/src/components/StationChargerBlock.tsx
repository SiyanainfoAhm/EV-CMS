import { Text, View, StyleSheet } from "react-native";
import type { Charger, ChargerConnector } from "../types";
import StationConnectorCard from "./StationConnectorCard";
import {
  formatLastUsed,
  formatPowerLine,
  getChargerDisplayName,
} from "../utils/dfccilDisplay";
import { formatCurrency } from "../utils/format";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";

type Props = {
  charger: Charger;
  ratePerKwh: number;
  selectedConnectorId?: string | null;
  busyConnectorIds?: Set<number>;
  onSelectConnector: (charger: Charger, connector: ChargerConnector) => void;
};

export default function StationChargerBlock({
  charger,
  ratePerKwh,
  selectedConnectorId,
  busyConnectorIds,
  onSelectConnector,
}: Props) {
  const name = getChargerDisplayName(charger);
  const connectors = [...charger.connectors].sort((a, b) => a.connectorId - b.connectorId);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.flex}>
          <Text style={styles.name}>{name}</Text>
          <Text style={styles.typeLine}>{formatPowerLine(charger)}</Text>
          <Text style={styles.lastUsed}>{formatLastUsed(charger.lastHeartbeat)}</Text>
        </View>
        <Text style={styles.rate}>{formatCurrency(ratePerKwh)}/kWh</Text>
      </View>

      {connectors.length === 0 ? (
        <Text style={styles.empty}>No connectors</Text>
      ) : (
        connectors.map((conn) => {
          const busy = busyConnectorIds?.has(conn.connectorId) ?? false;
          return (
            <StationConnectorCard
              key={conn.id}
              charger={charger}
              connector={conn}
              selected={selectedConnectorId === conn.id}
              disabled={busy}
              onPress={() => onSelectConnector(charger, conn)}
            />
          );
        })
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  flex: { flex: 1 },
  name: {
    fontSize: 17,
    fontWeight: "800",
    color: colors.text,
  },
  typeLine: {
    marginTop: 4,
    fontSize: 13,
    fontWeight: "600",
    color: colors.textMuted,
  },
  lastUsed: {
    marginTop: 4,
    fontSize: 12,
    color: colors.textMuted,
  },
  rate: {
    fontSize: 14,
    fontWeight: "800",
    color: colors.orange,
  },
  empty: {
    marginTop: spacing.sm,
    color: colors.textMuted,
    fontSize: 13,
  },
});
