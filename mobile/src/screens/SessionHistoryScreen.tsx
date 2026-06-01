import { useEffect, useState } from "react";
import { ScrollView, StyleSheet } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import Header from "../components/Header";
import SessionCard from "../components/SessionCard";
import * as sessionService from "../services/sessionService";
import type { ChargingSession } from "../types";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";

type Props = NativeStackScreenProps<RootStackParamList, "SessionHistory">;

export default function SessionHistoryScreen({ navigation }: Props) {
  const [sessions, setSessions] = useState<ChargingSession[]>([]);

  useEffect(() => {
    sessionService.getSessionHistory().then(setSessions);
  }, []);

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Header title="Session History" onBack={() => navigation.goBack()} />
      {sessions.map((s) => (
        <SessionCard key={s.id} session={s} />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
});
