import { Text, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import AppCard from "./AppCard";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";

export default function SimulationModeBadge({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();

  return (
    <AppCard style={[styles.card, compact && styles.compact]}>
      <Text style={styles.title}>{t("simulation.title")}</Text>
      {!compact && <Text style={styles.body}>{t("simulation.body")}</Text>}
    </AppCard>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: "#fffbeb", borderColor: "#fde68a", marginBottom: spacing.sm },
  compact: { paddingVertical: spacing.sm },
  title: { fontWeight: "700", color: "#92400e", fontSize: 14 },
  body: { marginTop: 6, fontSize: 12, color: "#a16207", lineHeight: 18 },
});
