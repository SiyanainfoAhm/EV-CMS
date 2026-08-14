import { Pressable, Text, View, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import type { Charger } from "../types";
import AppCard from "./AppCard";
import StatusBadge from "./StatusBadge";
import { canStartCharging } from "../services/chargerService";
import {
  dfccilChargerDisplayName,
  formatLastUsed,
  formatPowerLine,
  isDcCharger,
  plugTypeForCharger,
} from "../utils/dfccilDisplay";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";

interface Props {
  charger: Charger;
  displayIndex?: number;
  onPress: () => void;
}

export default function ChargerCard({ charger, displayIndex, onPress }: Props) {
  const { t } = useTranslation();
  const displayName = dfccilChargerDisplayName(charger, displayIndex);
  const chargeable = canStartCharging(charger);
  const plug = plugTypeForCharger(charger);
  const availableCount = charger.connectors.filter((c) => {
    const s = String(c.status || "").toLowerCase();
    return s === "available" || s === "preparing";
  }).length;

  return (
    <Pressable onPress={onPress}>
      <AppCard style={[styles.card, !chargeable && styles.cardUnavailable]}>
        <View style={styles.row}>
          <View style={[styles.icon, isDcCharger(charger) ? styles.iconDc : styles.iconAc]}>
            <Text style={styles.iconText}>{isDcCharger(charger) ? "DC" : "AC"}</Text>
          </View>
          <View style={styles.flex}>
            <Text style={styles.name}>{displayName}</Text>
            <Text style={styles.meta}>{formatPowerLine(charger)}</Text>
            <Text style={styles.meta}>
              {plug} · {availableCount}/{charger.connectors.length || 0} available
            </Text>
            <Text style={styles.meta}>{formatLastUsed(charger.lastHeartbeat)}</Text>
            {!chargeable ? (
              <Text style={styles.unavailable}>{t("charger.chargingUnavailable")}</Text>
            ) : null}
          </View>
          <StatusBadge status={charger.status || "unknown"} />
        </View>
      </AppCard>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.sm, borderRadius: 16 },
  cardUnavailable: { opacity: 0.92 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  icon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  iconAc: { backgroundColor: colors.emeraldMuted },
  iconDc: { backgroundColor: colors.orangeMuted },
  iconText: { fontSize: 12, fontWeight: "800", color: colors.text },
  flex: { flex: 1 },
  name: { fontSize: 16, fontWeight: "800", color: colors.text },
  meta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  unavailable: {
    marginTop: 6,
    fontSize: 12,
    fontWeight: "600",
    color: colors.danger,
  },
});
