import { createNativeStackNavigator } from "@react-navigation/native-stack";
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
import * as authService from "../services/authService";

export type RootStackParamList = {
  Login: undefined;
  Home: undefined;
  Chargers: undefined;
  ChargerDetail: { id: string };
  QRStart: { chargerId: string };
  LiveSession: undefined;
  SessionHistory: undefined;
  PaymentHistory: undefined;
  RFIDBinding: undefined;
  Profile: undefined;
  Support: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function AppNavigator() {
  const authed = authService.isAuthenticated();

  return (
    <Stack.Navigator
      initialRouteName={authed ? "Home" : "Login"}
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: "#f5f5f3" },
      }}
    >
      <Stack.Screen name="Login" component={LoginScreen} />
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
    </Stack.Navigator>
  );
}
