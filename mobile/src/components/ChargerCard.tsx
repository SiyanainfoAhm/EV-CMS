import { Pressable, Text, View, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import type { Charger } from "../types";
import AppCard from "./AppCard";
import StatusBadge from "./StatusBadge";
import { canStartCharging } from "../services/chargerService";
import {
  translateChargerLocation,
  translateChargerName,
  translateChargerType,
} from "../utils/translateRecord";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";

interface Props {
  charger: Charger;
  onPress: () => void;
}

export default function ChargerCard({ charger, onPress }: Props) {
  const { t } = useTranslation();
  const displayName = translateChargerName(t, charger.chargePointId, charger.name);
  const displayLocation = translateChargerLocation(t, charger.chargePointId, charger.location);
  const manufacturerModel = [charger.manufacturer, charger.model].filter(Boolean).join(" · ");
  const chargeable = canStartCharging(charger);

  return (
    <Pressable onPress={onPress}>
      <AppCard style={[styles.card, !chargeable && styles.cardUnavailable]}>
        <View style={styles.row}>
          <View style={[styles.icon, !chargeable && styles.iconMuted]}>
            <Text style={styles.iconText}>⚡</Text>
          </View>
          <View style={styles.flex}>
            <View style={styles.titleRow}>
              <Text style={styles.name}>{displayName}</Text>
              {charger.isSimulated ? (
                <View style={styles.simBadge}>
                  <Text style={styles.simBadgeText}>{t("charger.simulatedBadge")}</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.meta}>{charger.chargePointId}</Text>
            <Text style={styles.meta}>
              {translateChargerType(t, charger.type)} · {charger.maxPowerKw || "—"} kW
            </Text>
            {displayLocation ? <Text style={styles.meta}>{displayLocation}</Text> : null}
            {manufacturerModel ? <Text style={styles.meta}>{manufacturerModel}</Text> : null}
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
  card: { marginBottom: spacing.sm },
  cardUnavailable: { opacity: 0.92 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  icon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.emeraldMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  iconMuted: { backgroundColor: "#f3f4f6" },
  iconText: { fontSize: 20 },
  flex: { flex: 1 },
  titleRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  name: { fontSize: 16, fontWeight: "600", color: colors.text },
  meta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  unavailable: {
    marginTop: 6,
    fontSize: 12,
    fontWeight: "600",
    color: colors.danger,
  },
  simBadge: {
    backgroundColor: "#fffbeb",
    borderColor: "#fde68a",
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  simBadgeText: { fontSize: 10, fontWeight: "700", color: "#92400e" },
});
