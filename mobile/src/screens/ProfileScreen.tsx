import { View, Text, StyleSheet } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import Header from "../components/Header";
import AppCard from "../components/AppCard";
import AppButton from "../components/AppButton";
import * as authService from "../services/authService";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";

type Props = NativeStackScreenProps<RootStackParamList, "Profile">;

export default function ProfileScreen({ navigation }: Props) {
  const user = authService.getSessionUser();

  const logout = () => {
    authService.logout();
    navigation.reset({ index: 0, routes: [{ name: "Login" }] });
  };

  return (
    <View style={styles.root}>
      <Header title="Profile" onBack={() => navigation.goBack()} />
      <AppCard>
        <Text style={styles.name}>{user?.name}</Text>
        <Text style={styles.email}>{user?.email}</Text>
        <Text style={styles.role}>{user?.role}</Text>
        {user?.phone ? <Text style={styles.phone}>{user.phone}</Text> : null}
      </AppCard>
      <AppButton title="Sign out" onPress={logout} variant="outline" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background, padding: spacing.md },
  name: { fontSize: 20, fontWeight: "700", color: colors.text },
  email: { color: colors.textMuted, marginTop: 6 },
  role: { color: colors.emerald, marginTop: 8, fontWeight: "600" },
  phone: { color: colors.textMuted, marginTop: 4 },
});
