import { Text, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";

export interface MapRegion {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

export interface MapMarker {
  id: string;
  latitude: number;
  longitude: number;
  title: string;
  description?: string;
  onPress?: () => void;
}

interface Props {
  region: MapRegion;
  userLocation: { latitude: number; longitude: number } | null;
  markers: MapMarker[];
}

/** Web: map is native-only; show list fallback message. */
export default function ChargerMapView(_props: Props) {
  const { t } = useTranslation();
  return (
    <Text style={styles.muted}>
      {t("dashboard.nearestChargers")} — map available on Android/iOS app. Showing nearest list below.
    </Text>
  );
}

const styles = StyleSheet.create({
  muted: { color: colors.textMuted, marginBottom: spacing.sm, fontSize: 13 },
});
