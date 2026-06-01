import { useEffect, useState } from "react";
import { Text, ScrollView, StyleSheet } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import Header from "../components/Header";
import AppCard from "../components/AppCard";
import AppButton from "../components/AppButton";
import StatusBadge from "../components/StatusBadge";
import * as rfidService from "../services/rfidService";
import type { RFIDCard } from "../types";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";

type Props = NativeStackScreenProps<RootStackParamList, "RFIDBinding">;

export default function RFIDBindingScreen({ navigation }: Props) {
  const [cards, setCards] = useState<RFIDCard[]>([]);

  useEffect(() => {
    rfidService.getUserRfidCards().then(setCards);
  }, []);

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Header title="RFID Cards" onBack={() => navigation.goBack()} />
      {cards.map((c) => (
        <AppCard key={c.id} style={styles.card}>
          <Text style={styles.uid}>{c.uid}</Text>
          <StatusBadge status={c.status} />
        </AppCard>
      ))}
      <AppButton title="Bind New RFID" onPress={() => rfidService.bindRfid("RFID-NEW")} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  card: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.sm },
  uid: { fontWeight: "600", color: colors.text },
});
