import { View, Text, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { colors } from "../theme/colors";
import { translateEnum, type EnumNamespace } from "../utils/translateRecord";

interface Props {
  status: string;
  enumNamespace?: EnumNamespace;
}

function badgeColors(status: string) {
  const s = status.toLowerCase();
  if (["online", "active", "available", "success", "completed", "paid", "resolved", "closed"].some((x) => s.includes(x))) {
    return { bg: colors.emeraldMuted, text: colors.emerald };
  }
  if (["faulted", "failed", "blocked"].some((x) => s.includes(x))) {
    return { bg: "#fee2e2", text: colors.danger };
  }
  if (["charging", "in_progress", "started", "stopping", "pending", "urgent", "high"].some((x) => s.includes(x))) {
    return { bg: "#d1fae5", text: "#047857" };
  }
  return { bg: "#f3f4f6", text: colors.textMuted };
}

export default function StatusBadge({ status, enumNamespace = "status" }: Props) {
  const { t } = useTranslation();
  const label = translateEnum(t, enumNamespace, status);
  const c = badgeColors(status);
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }]}>
      <Text style={[styles.text, { color: c.text }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  text: { fontSize: 12, fontWeight: "600" },
});
