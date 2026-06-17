import * as Location from "expo-location";
import { distanceKm } from "../utils/geo";
import type { Charger } from "../types";

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export async function getCurrentLocation(): Promise<Coordinates> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== "granted") {
    throw new Error("LOCATION_DENIED");
  }
  const position = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
  };
}

export function calculateDistanceKm(
  from: Coordinates,
  to: { latitude: number; longitude: number }
): number {
  return distanceKm(from.latitude, from.longitude, to.latitude, to.longitude);
}

export function sortChargersByDistance(
  chargers: Charger[],
  from: Coordinates
): Charger[] {
  return [...chargers]
    .map((c) => {
      if (c.latitude == null || c.longitude == null) return c;
      const km = calculateDistanceKm(from, {
        latitude: c.latitude,
        longitude: c.longitude,
      });
      return { ...c, distanceKm: Math.round(km * 10) / 10 };
    })
    .sort((a, b) => {
      const da = a.distanceKm ?? Number.POSITIVE_INFINITY;
      const db = b.distanceKm ?? Number.POSITIVE_INFINITY;
      return da - db;
    });
}
