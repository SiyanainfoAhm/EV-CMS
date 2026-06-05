import { Text, StyleSheet } from "react-native";
import AppCard from "./AppCard";
import { MOBILE_ADMIN_NOTICE } from "../utils/rfpRoles";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";

export default function AdminNoticeBanner() {
  return (
    <AppCard style={styles.card}>
      <Text style={styles.title}>Admin account — monitoring only</Text>
      <Text style={styles.body}>{MOBILE_ADMIN_NOTICE}</Text>
    </AppCard>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: "#eff6ff", borderColor: "#bfdbfe", marginBottom: spacing.sm },
  title: { fontWeight: "700", color: "#1e40af", fontSize: 14 },
  body: { marginTop: 6, fontSize: 12, color: "#1d4ed8", lineHeight: 18 },
});
