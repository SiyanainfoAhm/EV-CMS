import { View, Text, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";
import { typography } from "../theme/typography";

interface Props {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  rightAction?: { icon: keyof typeof Ionicons.glyphMap; onPress: () => void };
}

export default function Header({ title, subtitle, onBack, rightAction }: Props) {
  return (
    <View style={styles.wrap}>
      {onBack ? (
        <Pressable onPress={onBack} style={styles.back}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
      ) : (
        <View style={styles.backPlaceholder} />
      )}
      <View style={styles.center}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {rightAction ? (
        <Pressable onPress={rightAction.onPress}>
          <Ionicons name={rightAction.icon} size={22} color={colors.emerald} />
        </Pressable>
      ) : (
        <View style={styles.backPlaceholder} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.background,
  },
  back: { width: 40 },
  backPlaceholder: { width: 40 },
  center: { flex: 1 },
  title: { ...typography.h3, color: colors.text },
  subtitle: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
});
