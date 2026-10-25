// Google Maps link for an event: pinned coordinates when available, otherwise the venue text.
function eventMapsUrl(event) {
  const location = event.location;
  if (location && Number.isFinite(location.lat) && Number.isFinite(location.lng)) {
    const params = new URLSearchParams({ api: '1', query: `${location.lat},${location.lng}` });
    if (location.placeId) params.set('query_place_id', location.placeId);
    return `https://www.google.com/maps/search/?${params}`;
  }
  return event.venue ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.venue)}` : '';
}

module.exports = { eventMapsUrl };
