import { Alert } from "react-native";
import type { TFunction } from "i18next";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";

export function showChargingErrorAlert(
  error: unknown,
  t: TFunction,
  _navigation: NativeStackNavigationProp<RootStackParamList>
): void {
  const code = error instanceof Error ? error.message : "UNKNOWN";
  if (code === "USER_INACTIVE") {
    Alert.alert(t("common.error"), t("charger.userInactive"));
    return;
  }
  if (/not online|CHARGER_NOT_ONLINE/i.test(code)) {
    Alert.alert(t("common.error"), t("charger.cannotStartNotOnline"));
    return;
  }
  Alert.alert(t("common.error"), error instanceof Error ? error.message : t("charger.startFailed"));
}
