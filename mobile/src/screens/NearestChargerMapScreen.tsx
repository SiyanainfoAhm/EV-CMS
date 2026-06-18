import { useCallback, useEffect, useState } from "react";
import { Text, ScrollView, StyleSheet, ActivityIndicator, Platform } from "react-native";
import Constants from "expo-constants";
import { useTranslation } from "react-i18next";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import Header from "../components/Header";
import ChargerCard from "../components/ChargerCard";
import ChargerMapView from "../components/ChargerMapView";
import * as chargerService from "../services/chargerService";
import * as locationService from "../services/locationService";
import { translateChargerLocation, translateChargerName } from "../utils/translateRecord";
import type { Charger } from "../types";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";

type Props = NativeStackScreenProps<RootStackParamList, "NearestMap">;

export default function NearestChargerMapScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const [chargers, setChargers] = useState<Charger[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);

  const mapsApiKey =
    Constants.expoConfig?.android?.config?.googleMaps?.apiKey ?? "";
  const showMap = Platform.OS !== "web" && Boolean(mapsApiKey);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const position = await locationService.getCurrentLocation();
      setCoords(position);
      setChargers(
        await chargerService.getNearestChargers(position.latitude, position.longitude, 20)
      );
    } catch (e) {
      if (e instanceof Error && e.message === "LOCATION_DENIED") {
        setError(t("qr.permissionRequired"));
      } else {
        setError(e instanceof Error ? e.message : t("common.error"));
      }
      setChargers(await chargerService.getChargers({ onlineOnly: true }));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const region = coords
    ? {
        latitude: coords.latitude,
        longitude: coords.longitude,
        latitudeDelta: 0.08,
        longitudeDelta: 0.08,
      }
    : chargers[0]?.latitude != null && chargers[0]?.longitude != null
      ? {
          latitude: chargers[0].latitude!,
          longitude: chargers[0].longitude!,
          latitudeDelta: 0.5,
          longitudeDelta: 0.5,
        }
      : {
          latitude: 28.6139,
          longitude: 77.209,
          latitudeDelta: 8,
          longitudeDelta: 8,
        };

  const markers = chargers
    .filter((c) => c.latitude != null && c.longitude != null)
    .map((c) => ({
      id: c.id,
      latitude: c.latitude!,
      longitude: c.longitude!,
      title: translateChargerName(t, c.chargePointId, c.name),
      description: translateChargerLocation(t, c.chargePointId, c.location),
      onPress: () => navigation.navigate("ChargerDetail", { id: c.id }),
    }));

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Header
        title={t("dashboard.nearestChargers")}
        subtitle={t("charger.listSubtitle")}
        onBack={() => navigation.goBack()}
      />
      {loading ? <ActivityIndicator color={colors.emerald} style={{ marginVertical: spacing.md }} /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {showMap ? (
        <ChargerMapView region={region} userLocation={coords} markers={markers} />
      ) : Platform.OS !== "web" ? (
        <Text style={styles.muted}>
          Map unavailable — add Google Maps API key in app.json (android.config.googleMaps.apiKey).
        </Text>
      ) : (
        <ChargerMapView region={region} userLocation={coords} markers={markers} />
      )}

      {chargers.slice(0, 10).map((c) => (
        <ChargerCard key={c.id} charger={c} onPress={() => navigation.navigate("ChargerDetail", { id: c.id })} />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  error: { color: colors.danger, marginBottom: spacing.sm },
  muted: { color: colors.textMuted, marginBottom: spacing.sm, fontSize: 13 },
});
