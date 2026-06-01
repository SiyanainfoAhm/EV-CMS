import { Text, TextInput, View, StyleSheet } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import Header from "../components/Header";
import AppCard from "../components/AppCard";
import AppButton from "../components/AppButton";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";

type Props = NativeStackScreenProps<RootStackParamList, "Support">;

export default function SupportScreen({ navigation }: Props) {
  return (
    <View style={styles.root}>
      <Header title="Support" onBack={() => navigation.goBack()} />
      <AppCard>
        <Text style={styles.label}>Subject</Text>
        <TextInput style={styles.input} placeholder="Charging issue, payment, RFID..." placeholderTextColor={colors.textMuted} />
        <Text style={[styles.label, { marginTop: spacing.md }]}>Message</Text>
        <TextInput style={[styles.input, styles.area]} multiline placeholder="Describe your issue" placeholderTextColor={colors.textMuted} />
      </AppCard>
      <Text style={styles.note}>Tickets are stored in "EV_SupportTickets" (TODO: API integration)</Text>
      <AppButton title="Submit Ticket" onPress={() => navigation.goBack()} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background, padding: spacing.md },
  label: { fontWeight: "600", color: colors.text, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: spacing.md,
    backgroundColor: colors.card,
  },
  area: { minHeight: 100, textAlignVertical: "top" },
  note: { fontSize: 12, color: colors.textMuted, marginVertical: spacing.md },
});
