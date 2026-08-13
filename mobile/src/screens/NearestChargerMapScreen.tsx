import { useCallback, useEffect, useMemo, useState } from "react";
import { Text, ScrollView, StyleSheet, ActivityIndicator, Platform, View } from "react-native";
import Constants from "expo-constants";
import { useTranslation } from "react-i18next";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import Header from "../components/Header";
import ChargerCard from "../components/ChargerCard";
import ChargerMapView from "../components/ChargerMapView";
import * as chargerService from "../services/chargerService";
import * as locationService from "../services/locationService";
import {
  getDefaultSiteLocation,
  offsetSiteCoordinate,
} from "../services/siteLocationService";
import {
  buildChargerDisplayIndexMap,
  chargerKindLabel,
  dfccilChargerDisplayName,
  isVisibleFleetCharger,
} from "../utils/dfccilDisplay";
import type { Charger } from "../types";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";

type Props = NativeStackScreenProps<RootStackParamList, "NearestMap">;

type MapPoint = {
  charger: Charger;
  latitude: number;
  longitude: number;
  fromFallback: boolean;
};

export default function NearestChargerMapScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const [chargers, setChargers] = useState<Charger[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [siteFallback, setSiteFallback] = useState<{
    latitude: number;
    longitude: number;
    label?: string;
  } | null>(null);

  const mapsApiKey = Constants.expoConfig?.android?.config?.googleMaps?.apiKey ?? "";
  const showNativeMap = Platform.OS !== "web" && Boolean(mapsApiKey);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [fallback, fleet] = await Promise.all([
        getDefaultSiteLocation(),
        chargerService.fetchChargers(),
      ]);
      setSiteFallback(fallback);

      const visible = fleet.filter(isVisibleFleetCharger);
      setChargers(visible);

      try {
        const position = await locationService.getCurrentLocation();
        setCoords(position);
      } catch (e) {
        if (e instanceof Error && e.message === "LOCATION_DENIED") {
          setError(t("qr.permissionRequired"));
        }
        setCoords(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.error"));
      setChargers([]);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const indexMap = useMemo(() => buildChargerDisplayIndexMap(chargers), [chargers]);

  const mapPoints: MapPoint[] = useMemo(() => {
    const withOwnCoords = chargers.filter((c) => c.latitude != null && c.longitude != null);
    if (withOwnCoords.length > 0) {
      return withOwnCoords.map((c) => ({
        charger: c,
        latitude: c.latitude!,
        longitude: c.longitude!,
        fromFallback: false,
      }));
    }
    if (siteFallback) {
      return chargers.map((c, i) => {
        const offset = offsetSiteCoordinate(siteFallback, i);
        return {
          charger: c,
          latitude: offset.latitude,
          longitude: offset.longitude,
          fromFallback: true,
        };
      });
    }
    return [];
  }, [chargers, siteFallback]);

  const hasAnyCoords = mapPoints.length > 0;
  const usingSiteFallbackOnly =
    hasAnyCoords && mapPoints.every((p) => p.fromFallback) && Boolean(siteFallback);

  const region = useMemo(() => {
    if (coords) {
      return {
        latitude: coords.latitude,
        longitude: coords.longitude,
        latitudeDelta: 0.08,
        longitudeDelta: 0.08,
      };
    }
    if (mapPoints[0]) {
      return {
        latitude: mapPoints[0].latitude,
        longitude: mapPoints[0].longitude,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      };
    }
    if (siteFallback) {
      return {
        latitude: siteFallback.latitude,
        longitude: siteFallback.longitude,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      };
    }
    return {
      latitude: 28.6139,
      longitude: 77.209,
      latitudeDelta: 0.5,
      longitudeDelta: 0.5,
    };
  }, [coords, mapPoints, siteFallback]);

  const markers = mapPoints.map((p) => {
    const name = dfccilChargerDisplayName(p.charger, indexMap.get(p.charger.id));
    const available = p.charger.connectors.filter((c) => {
      const s = String(c.status || "").toLowerCase();
      return s === "available" || s === "preparing";
    }).length;
    return {
      id: p.charger.id,
      latitude: p.latitude,
      longitude: p.longitude,
      title: name,
      description: `${chargerKindLabel(p.charger)} · ${String(p.charger.status || "unknown")} · ${available} available`,
      onPress: () => navigation.navigate("ChargerDetail", { id: p.charger.id }),
    };
  });

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Header
        title={t("dashboard.nearestChargers")}
        subtitle={t("charger.listSubtitle")}
        onBack={() => navigation.goBack()}
      />
      {loading ? (
        <ActivityIndicator color={colors.emerald} style={{ marginVertical: spacing.md }} />
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {!loading && !hasAnyCoords ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>Map location is not configured for chargers yet.</Text>
          <Text style={styles.emptyBody}>
            Add latitude/longitude on each charger in web admin, or set EV_SystemConfig key
            default_site_location with site coordinates. Charger locations are listed below.
          </Text>
        </View>
      ) : null}

      {hasAnyCoords && usingSiteFallbackOnly ? (
        <Text style={styles.muted}>
          Showing site default location
          {siteFallback?.label ? ` (${siteFallback.label})` : ""}. Per-charger coordinates are not
          set yet.
        </Text>
      ) : null}

      {hasAnyCoords && (showNativeMap || Platform.OS === "web") ? (
        <ChargerMapView region={region} userLocation={coords} markers={markers} />
      ) : null}

      {hasAnyCoords && Platform.OS !== "web" && !mapsApiKey ? (
        <Text style={styles.muted}>
          Map tiles unavailable — add Google Maps API key in app.json
          (android.config.googleMaps.apiKey). Markers/list still load below.
        </Text>
      ) : null}

      {chargers.map((c) => (
        <ChargerCard
          key={c.id}
          charger={c}
          displayIndex={indexMap.get(c.id)}
          onPress={() => navigation.navigate("ChargerDetail", { id: c.id })}
        />
      ))}
      {!loading && chargers.length === 0 ? (
        <Text style={styles.muted}>{t("charger.noneAvailable")}</Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  error: { color: colors.danger, marginBottom: spacing.sm },
  muted: { color: colors.textMuted, marginBottom: spacing.sm, fontSize: 13, lineHeight: 18 },
  emptyCard: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  emptyTitle: { fontSize: 15, fontWeight: "700", color: colors.text },
  emptyBody: { marginTop: 8, fontSize: 13, color: colors.textMuted, lineHeight: 19 },
});
