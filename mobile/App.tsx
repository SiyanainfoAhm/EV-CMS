import { StatusBar } from "expo-status-bar";
import { NavigationContainer } from "@react-navigation/native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StyleSheet, View } from "react-native";
import { AuthProvider } from "./src/context/AuthContext";
import { ConfirmProvider } from "./src/context/ConfirmContext";
import AppNavigator from "./src/navigation/AppNavigator";
import ErrorBoundary from "./src/components/ErrorBoundary";
import { colors } from "./src/theme/colors";

export default function App() {
  return (
    <ErrorBoundary>
      <SafeAreaProvider style={styles.root}>
        <ConfirmProvider>
          <AuthProvider>
            <NavigationContainer>
              <View style={styles.root}>
                <StatusBar style="dark" />
                <AppNavigator />
              </View>
            </NavigationContainer>
          </AuthProvider>
        </ConfirmProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
    minHeight: "100%",
  },
});
