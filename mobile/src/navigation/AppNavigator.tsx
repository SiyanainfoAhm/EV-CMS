import { ActivityIndicator, View, StyleSheet } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import LoginScreen from "../screens/LoginScreen";
import HomeScreen from "../screens/HomeScreen";
import ChargerListScreen from "../screens/ChargerListScreen";
import ChargerDetailScreen from "../screens/ChargerDetailScreen";
import QRStartScreen from "../screens/QRStartScreen";
import LiveSessionScreen from "../screens/LiveSessionScreen";
import SessionHistoryScreen from "../screens/SessionHistoryScreen";
import PaymentHistoryScreen from "../screens/PaymentHistoryScreen";
import RFIDBindingScreen from "../screens/RFIDBindingScreen";
import ProfileScreen from "../screens/ProfileScreen";
import SupportScreen from "../screens/SupportScreen";
import { colors } from "../theme/colors";

export type RootStackParamList = {
  Login: undefined;
  Home: undefined;
  Chargers: undefined;
  ChargerDetail: { id: string };
  QRStart: { chargerId: string; connectorId?: number };
  LiveSession: undefined;
  SessionHistory: undefined;
  PaymentHistory: undefined;
  RFIDBinding: undefined;
  Profile: undefined;
  Support: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function AppNavigator() {
  const { ready, isAuthenticated } = useAuth();

  if (!ready) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.emerald} />
      </View>
    );
  }

  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      {isAuthenticated ? (
        <>
          <Stack.Screen name="Home" component={HomeScreen} />
          <Stack.Screen name="Chargers" component={ChargerListScreen} />
          <Stack.Screen name="ChargerDetail" component={ChargerDetailScreen} />
          <Stack.Screen name="QRStart" component={QRStartScreen} />
          <Stack.Screen name="LiveSession" component={LiveSessionScreen} />
          <Stack.Screen name="SessionHistory" component={SessionHistoryScreen} />
          <Stack.Screen name="PaymentHistory" component={PaymentHistoryScreen} />
          <Stack.Screen name="RFIDBinding" component={RFIDBindingScreen} />
          <Stack.Screen name="Profile" component={ProfileScreen} />
          <Stack.Screen name="Support" component={SupportScreen} />
        </>
      ) : (
        <Stack.Screen name="Login" component={LoginScreen} />
      )}
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
});
