import { Alert } from "react-native";
import type { TFunction } from "i18next";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";

const WALLET_CODES = new Set(["WALLET_LOW_BALANCE", "WALLET_BLOCKED", "WALLET_NOT_FOUND"]);

export function isWalletChargingError(code: string): boolean {
  return WALLET_CODES.has(code);
}

export function showChargingErrorAlert(
  error: unknown,
  t: TFunction,
  navigation: NativeStackNavigationProp<RootStackParamList>
): void {
  const code = error instanceof Error ? error.message : "UNKNOWN";
  if (code === "WALLET_LOW_BALANCE") {
    Alert.alert(t("common.error"), t("wallet.lowBalance"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("wallet.topUp"), onPress: () => navigation.navigate("Topup") },
    ]);
    return;
  }
  if (code === "WALLET_BLOCKED") {
    Alert.alert(t("common.error"), t("wallet.walletBlocked"));
    return;
  }
  if (code === "WALLET_NOT_FOUND") {
    Alert.alert(t("common.error"), t("wallet.notFound"));
    return;
  }
  if (code === "USER_INACTIVE") {
    Alert.alert(t("common.error"), t("charger.userInactive"));
    return;
  }
  Alert.alert(t("common.error"), error instanceof Error ? error.message : t("charger.startFailed"));
}
