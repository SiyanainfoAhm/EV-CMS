import { useEffect, useState } from "react";
import { View, Text, ScrollView, StyleSheet, Pressable } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import AppCard from "../components/AppCard";
import * as authService from "../services/authService";
import * as sessionService from "../services/sessionService";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";
import { typography } from "../theme/typography";

type Props = NativeStackScreenProps<RootStackParamList, "Home">;

const menuItems: { label: string; route: keyof RootStackParamList }[] = [
  { label: "Find Chargers", route: "Chargers" },
  { label: "Live Session", route: "LiveSession" },
  { label: "Session History", route: "SessionHistory" },
  { label: "Payments", route: "PaymentHistory" },
  { label: "RFID Cards", route: "RFIDBinding" },
  { label: "Profile", route: "Profile" },
  { label: "Support", route: "Support" },
];

export default function HomeScreen({ navigation }: Props) {
  const user = authService.getSessionUser();
  const [hasActive, setHasActive] = useState(false);

  useEffect(() => {
    sessionService.getActiveSession().then((s) => setHasActive(!!s));
  }, []);

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <View>
          <Text style={styles.greet}>Hello, {user?.name?.split(" ")[0] ?? "User"}</Text>
          <Text style={styles.sub}>DFCCIL EV Charging</Text>
        </View>
        <Pressable style={styles.avatar} onPress={() => navigation.navigate("Profile")}>
          <Text style={styles.avatarText}>
            {user?.name?.split(" ").map((n) => n[0]).join("").slice(0, 2) ?? "EV"}
          </Text>
        </Pressable>
      </View>

      {hasActive && (
        <Pressable onPress={() => navigation.navigate("LiveSession")}>
          <AppCard style={styles.activeCard}>
            <Text style={styles.activeTitle}>Charging in progress</Text>
            <Text style={styles.activeLink}>View live session →</Text>
          </AppCard>
        </Pressable>
      )}

      <Text style={styles.section}>Quick actions</Text>
      {menuItems.map((item) => (
        <Pressable key={item.route} onPress={() => navigation.navigate(item.route)}>
          <AppCard style={styles.menuItem}>
            <Text style={styles.menuText}>{item.label}</Text>
            <Text style={styles.chevron}>›</Text>
          </AppCard>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.lg },
  greet: { ...typography.h2, color: colors.text },
  sub: { color: colors.textMuted, marginTop: 4 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.emeraldMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: colors.emerald, fontWeight: "700" },
  activeCard: { backgroundColor: colors.navy, marginBottom: spacing.md },
  activeTitle: { color: colors.white, fontWeight: "600", fontSize: 16 },
  activeLink: { color: colors.emeraldLight, marginTop: 6 },
  section: { ...typography.label, color: colors.textMuted, marginBottom: spacing.sm, marginTop: spacing.sm },
  menuItem: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.sm },
  menuText: { fontSize: 16, fontWeight: "500", color: colors.text },
  chevron: { fontSize: 22, color: colors.textMuted },
});
