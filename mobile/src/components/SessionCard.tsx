import { Pressable, Text, View, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import type { ChargingSession } from "../types";
import AppCard from "./AppCard";
import StatusBadge from "./StatusBadge";
import { getChargerDisplayName } from "../utils/dfccilDisplay";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";

interface Props {
  session: ChargingSession;
  onPress?: () => void;
}

export default function SessionCard({ session, onPress }: Props) {
  const { t } = useTranslation();
  const displayName = getChargerDisplayName({
    name: session.chargerName,
    chargePointId: session.chargePointId,
  });

  const content = (
    <AppCard style={styles.card}>
      <View style={styles.row}>
        <Text style={styles.title}>{displayName}</Text>
        <StatusBadge status={session.status} />
      </View>
      <Text style={styles.meta}>
        {session.chargePointId} · {t("session.connector")} {session.connectorId}
      </Text>
      <View style={styles.stats}>
        <View>
          <Text style={styles.statLabel}>{t("session.kwhConsumed")}</Text>
          <Text style={styles.statValue}>{session.energyKwh} kWh</Text>
        </View>
        <View>
          <Text style={styles.statLabel}>{t("session.duration")}</Text>
          <Text style={styles.statValue}>{session.duration}</Text>
        </View>
        {session.amount != null && (
          <View>
            <Text style={styles.statLabel}>{t("payment.amount")}</Text>
            <Text style={styles.statValue}>₹{session.amount}</Text>
          </View>
        )}
      </View>
    </AppCard>
  );

  if (onPress) {
    return <Pressable onPress={onPress}>{content}</Pressable>;
  }
  return content;
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.sm },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { fontSize: 16, fontWeight: "600", color: colors.text, flex: 1 },
  meta: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
  stats: { flexDirection: "row", marginTop: spacing.md, gap: spacing.lg },
  statLabel: { fontSize: 11, color: colors.textMuted },
  statValue: { fontSize: 15, fontWeight: "600", color: colors.text, marginTop: 2 },
});
