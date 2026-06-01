import { View, Text, StyleSheet } from "react-native";
import { colors } from "../theme/colors";

interface Props {
  status: string;
}

function badgeColors(status: string) {
  const s = status.toLowerCase();
  if (["online", "active", "available", "success", "completed"].some((x) => s.includes(x))) {
    return { bg: colors.emeraldMuted, text: colors.emerald };
  }
  if (["faulted", "failed", "blocked"].some((x) => s.includes(x))) {
    return { bg: "#fee2e2", text: colors.danger };
  }
  if (["charging"].some((x) => s.includes(x))) {
    return { bg: "#d1fae5", text: "#047857" };
  }
  return { bg: "#f3f4f6", text: colors.textMuted };
}

export default function StatusBadge({ status }: Props) {
  const c = badgeColors(status);
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }]}>
      <Text style={[styles.text, { color: c.text }]}>{status}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  text: { fontSize: 12, fontWeight: "600", textTransform: "capitalize" },
});
