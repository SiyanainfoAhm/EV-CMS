import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { I18nextProvider } from "react-i18next";
import { StyleSheet, View } from "react-native";
import { AuthProvider } from "./src/context/AuthContext";
import { ConfirmProvider } from "./src/context/ConfirmContext";
import AppNavigator from "./src/navigation/AppNavigator";
import { navigationRef } from "./src/navigation/navigationRef";
import ErrorBoundary from "./src/components/ErrorBoundary";
import i18n, { loadStoredLanguage, type AppLanguage } from "./src/i18n";
import { colors } from "./src/theme/colors";

export default function App() {
  const [langReady, setLangReady] = useState(false);
  const [, setLang] = useState<AppLanguage>("en");

  useEffect(() => {
    loadStoredLanguage()
      .then(setLang)
      .finally(() => setLangReady(true));
  }, []);

  if (!langReady) {
    return <View style={styles.root} />;
  }

  return (
    <ErrorBoundary>
      <I18nextProvider i18n={i18n}>
        <SafeAreaProvider style={styles.root}>
          <ConfirmProvider>
            <AuthProvider>
              <NavigationContainer ref={navigationRef}>
                <View style={styles.root}>
                  <StatusBar style="dark" />
                  <AppNavigator />
                </View>
              </NavigationContainer>
            </AuthProvider>
          </ConfirmProvider>
        </SafeAreaProvider>
      </I18nextProvider>
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
