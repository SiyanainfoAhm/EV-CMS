import { View, StyleSheet } from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE } from "react-native-maps";
import { colors } from "../theme/colors";

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

export default function ChargerMapView({ region, userLocation, markers }: Props) {
  return (
    <View style={styles.wrap}>
      <MapView style={styles.map} provider={PROVIDER_GOOGLE} initialRegion={region} region={region}>
        {userLocation ? (
          <Marker coordinate={userLocation} title="You" pinColor={colors.emerald} />
        ) : null}
        {markers.map((m) => (
          <Marker
            key={m.id}
            coordinate={{ latitude: m.latitude, longitude: m.longitude }}
            title={m.title}
            description={m.description}
            onCalloutPress={m.onPress}
          />
        ))}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { height: 280, borderRadius: 16, overflow: "hidden", marginBottom: 16 },
  map: { flex: 1 },
});
