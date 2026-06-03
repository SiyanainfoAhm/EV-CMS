import { Pressable, Text, StyleSheet, ActivityIndicator, type StyleProp, type ViewStyle } from "react-native";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";

interface Props {
  title: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "outline";
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

export default function AppButton({ title, onPress, variant = "primary", loading, disabled, style }: Props) {
  const isPrimary = variant === "primary";
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.base,
        isPrimary ? styles.primary : variant === "outline" ? styles.outline : styles.secondary,
        (pressed || disabled) && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={isPrimary ? colors.white : colors.emerald} />
      ) : (
        <Text style={[styles.text, isPrimary ? styles.textPrimary : styles.textSecondary]}>{title}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: 12,
    alignItems: "center",
  },
  primary: { backgroundColor: colors.emerald },
  secondary: { backgroundColor: colors.emeraldMuted },
  outline: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.emerald },
  pressed: { opacity: 0.85 },
  text: { fontSize: 15, fontWeight: "600" },
  textPrimary: { color: colors.white },
  textSecondary: { color: colors.emerald },
});
