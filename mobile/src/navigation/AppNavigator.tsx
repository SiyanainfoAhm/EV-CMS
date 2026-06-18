import { ActivityIndicator, View, StyleSheet } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import LoginScreen from "../screens/LoginScreen";
import HomeScreen from "../screens/HomeScreen";
import ChargerListScreen from "../screens/ChargerListScreen";
import ChargerDetailScreen from "../screens/ChargerDetailScreen";
import NearestChargerMapScreen from "../screens/NearestChargerMapScreen";
import QRStartScreen from "../screens/QRStartScreen";
import LiveSessionScreen from "../screens/LiveSessionScreen";
import SessionSummaryScreen from "../screens/SessionSummaryScreen";
import SessionHistoryScreen from "../screens/SessionHistoryScreen";
import PaymentHistoryScreen from "../screens/PaymentHistoryScreen";
import WalletScreen from "../screens/WalletScreen";
import TopupScreen from "../screens/TopupScreen";
import TopupPaymentStatusScreen from "../screens/TopupPaymentStatusScreen";
import WalletTransactionHistoryScreen from "../screens/WalletTransactionHistoryScreen";
import RFIDBindingScreen from "../screens/RFIDBindingScreen";
import ProfileScreen from "../screens/ProfileScreen";
import SupportScreen from "../screens/SupportScreen";
import SupportTicketListScreen from "../screens/SupportTicketListScreen";
import SupportTicketDetailScreen from "../screens/SupportTicketDetailScreen";
import NotificationsScreen from "../screens/NotificationsScreen";
import NotificationListenerBridge from "../components/NotificationListenerBridge";
import { colors } from "../theme/colors";

export type RootStackParamList = {
  Login: undefined;
  Home: undefined;
  Chargers: undefined;
  NearestMap: undefined;
  ChargerDetail: { id: string };
  QRStart: { chargerId?: string; connectorId?: number };
  LiveSession: undefined;
  SessionSummary: { sessionId: string; focusPayment?: boolean };
  SessionHistory: undefined;
  PaymentHistory: undefined;
  Wallet: undefined;
  Topup: { suggestedAmount?: number; returnSessionId?: string } | undefined;
  TopupPaymentStatus: {
    paymentOrderId: string;
    returnSessionId?: string;
    razorpayOrderId?: string;
    razorpayPaymentId?: string;
    initialStatus?: string;
    initialWalletCredited?: boolean;
    initialMessage?: string;
  };
  WalletTransactions: undefined;
  RFIDBinding: undefined;
  Profile: undefined;
  Support: undefined;
  SupportTickets: undefined;
  SupportTicketDetail: { id: string };
  Notifications: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

const screenOptions = {
  headerShown: false,
  contentStyle: { backgroundColor: colors.background },
} as const;

function AuthStack() {
  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen name="Login" component={LoginScreen} />
    </Stack.Navigator>
  );
}

function MainStack() {
  return (
    <Stack.Navigator screenOptions={screenOptions} initialRouteName="Home">
      <Stack.Screen name="Home" component={HomeScreen} />
      <Stack.Screen name="Chargers" component={ChargerListScreen} />
      <Stack.Screen name="NearestMap" component={NearestChargerMapScreen} />
      <Stack.Screen name="ChargerDetail" component={ChargerDetailScreen} />
      <Stack.Screen name="QRStart" component={QRStartScreen} />
      <Stack.Screen name="LiveSession" component={LiveSessionScreen} />
      <Stack.Screen name="SessionSummary" component={SessionSummaryScreen} />
      <Stack.Screen name="SessionHistory" component={SessionHistoryScreen} />
      <Stack.Screen name="PaymentHistory" component={PaymentHistoryScreen} />
      <Stack.Screen name="Wallet" component={WalletScreen} />
      <Stack.Screen name="Topup" component={TopupScreen} />
      <Stack.Screen name="TopupPaymentStatus" component={TopupPaymentStatusScreen} />
      <Stack.Screen name="WalletTransactions" component={WalletTransactionHistoryScreen} />
      <Stack.Screen name="RFIDBinding" component={RFIDBindingScreen} />
      <Stack.Screen name="Profile" component={ProfileScreen} />
      <Stack.Screen name="Support" component={SupportScreen} />
      <Stack.Screen name="SupportTickets" component={SupportTicketListScreen} />
      <Stack.Screen name="SupportTicketDetail" component={SupportTicketDetailScreen} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} />
    </Stack.Navigator>
  );
}

export default function AppNavigator() {
  const { ready, isAuthenticated } = useAuth();

  if (!ready) {
    return (
      <View style={styles.root}>
        <ActivityIndicator size="large" color={colors.emerald} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {isAuthenticated ? (
        <>
          <NotificationListenerBridge />
          <MainStack key="main" />
        </>
      ) : (
        <AuthStack key="auth" />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
});
