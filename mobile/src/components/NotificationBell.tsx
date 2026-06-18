import { Pressable, Text, View, StyleSheet } from "react-native";
import { colors } from "../theme/colors";

interface Props {
  count: number;
  onPress: () => void;
}

export default function NotificationBell({ count, onPress }: Props) {
  return (
    <Pressable onPress={onPress} style={styles.wrap} accessibilityRole="button">
      <Text style={styles.icon}>🔔</Text>
      {count > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{count > 99 ? "99+" : count}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 6, marginRight: 4 },
  icon: { fontSize: 22 },
  badge: {
    position: "absolute",
    top: 0,
    right: 0,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.danger,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  badgeText: { color: colors.white, fontSize: 10, fontWeight: "700" },
});
