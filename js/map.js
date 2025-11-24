let map, pathLine, userMarker;

export function initMapModule(mapId) {
  map = L.map(mapId, { zoomControl: false }).setView([25.033, 121.5654], 15);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(map);
  pathLine = L.polyline([], { color: "blue", weight: 5 }).addTo(map);
  return map;
}

export function updateMapMarker(lat, lng, follow = false) {
  if (!map) return;
  if (!userMarker) {
    userMarker = L.marker([lat, lng]).addTo(map);
    map.setView([lat, lng], 17);
  } else {
    userMarker.setLatLng([lat, lng]);
    if (follow) map.setView([lat, lng]);
  }
}

export function drawPath(coordinates) {
  if (pathLine) pathLine.setLatLngs(coordinates);
}

export function resetMapLine() {
  if (pathLine) pathLine.setLatLngs([]);
}
