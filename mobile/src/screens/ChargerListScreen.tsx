import { useEffect, useState } from "react";
import { ScrollView, StyleSheet } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import Header from "../components/Header";
import ChargerCard from "../components/ChargerCard";
import * as chargerService from "../services/chargerService";
import type { Charger } from "../types";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";

type Props = NativeStackScreenProps<RootStackParamList, "Chargers">;

export default function ChargerListScreen({ navigation }: Props) {
  const [chargers, setChargers] = useState<Charger[]>([]);

  useEffect(() => {
    chargerService.getNearbyChargers().then(setChargers);
  }, []);

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Header title="Nearby Chargers" subtitle="Available at your site" onBack={() => navigation.goBack()} />
      {chargers.map((c) => (
        <ChargerCard key={c.id} charger={c} onPress={() => navigation.navigate("ChargerDetail", { id: c.id })} />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
});
