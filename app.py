"""Small API for Google Maps Platform routing and 3D tile sessions."""
from __future__ import annotations

import math
import os
import asyncio
import json
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

load_dotenv()
ROOT = Path(__file__).parent
API_KEY = os.getenv("GOOGLE_MAPS_API_KEY", "").strip()
LANDSD_3D_API_KEY = os.getenv("LANDSD_3D_MAP_API_KEY", "").strip()
ORIGIN = {"latitude": float(os.getenv("ORIGIN_LAT", "22.2855625")), "longitude": float(os.getenv("ORIGIN_LNG", "114.1347709"))}
DATA_FILE = Path(os.getenv("DATA_GEOJSON", "static/data/access-points.geojson"))
if not DATA_FILE.is_absolute():
    DATA_FILE = ROOT / DATA_FILE

app = FastAPI(title="Western District Access Explorer")
app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")


class Destination(BaseModel):
    id: str
    name: str
    kind: str = "green"
    latitude: float
    longitude: float


class AnalyzeRequest(BaseModel):
    origin: dict[str, float] | None = None
    destinations: list[Destination] = Field(default_factory=list, max_length=100)
    walk_time_seconds: int = Field(300, ge=100, le=2000)
    max_slope_deg: float = Field(10, ge=3, le=20)


@app.get("/")
async def index():
    return FileResponse(ROOT / "static" / "index.html")


@app.get("/api/config")
async def config():
    return {"google_enabled": bool(API_KEY), "landsd_3d_enabled": bool(LANDSD_3D_API_KEY), "origin": ORIGIN}


@app.get("/api/access-points")
async def access_points():
    if not DATA_FILE.exists():
        raise HTTPException(404, "Access point GeoJSON not found")
    return FileResponse(DATA_FILE, media_type="application/geo+json")


@app.get("/api/google-3d-session")
async def google_3d_session():
    if not API_KEY:
        raise HTTPException(503, "Google Maps Platform key is not configured")
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.get("https://tile.googleapis.com/v1/3dtiles/root.json", params={"key": API_KEY})
    if response.is_error:
        raise HTTPException(response.status_code, "Google Map Tiles API request failed")
    return response.json()


@app.get("/api/google-3d-tiles/{tile_path:path}")
async def google_3d_tiles(tile_path: str, request: Request):
    if not API_KEY:
        raise HTTPException(503, "Google Maps Platform key is not configured")
    if not tile_path.startswith("v1/3dtiles/") or ".." in Path(tile_path).parts:
        raise HTTPException(404, "Unknown Google 3D Tiles resource")
    params = dict(request.query_params)
    params["key"] = API_KEY
    url = f"https://tile.googleapis.com/{tile_path}"
    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        response = await client.get(url, params=params)
    if response.is_error:
        raise HTTPException(response.status_code, "Google Map Tiles API request failed")
    from fastapi.responses import Response
    content_type = response.headers.get("content-type", "application/octet-stream")
    content = response.content
    if "json" in content_type:
        document = response.json()

        def proxy_tile_uris(value):
            if isinstance(value, dict):
                for key, item in value.items():
                    if key in {"uri", "url", "template"} and isinstance(item, str):
                        absolute = urljoin(url, item)
                        parsed = urlsplit(absolute)
                        if parsed.hostname == "tile.googleapis.com" and parsed.path.startswith("/v1/3dtiles/"):
                            value[key] = urlunsplit(("", "", "/api/google-3d-tiles" + parsed.path, strip_api_key(parsed.query), parsed.fragment))
                    else:
                        proxy_tile_uris(item)
            elif isinstance(value, list):
                for item in value:
                    proxy_tile_uris(item)

        proxy_tile_uris(document)
        content = json.dumps(document, separators=(",", ":")).encode("utf-8")
    return Response(content, media_type=content_type)


@app.get("/api/landsd-3d-tiles/{tile_path:path}")
async def landsd_3d_tiles(tile_path: str, request: Request):
    """Proxy official Lands Department Cesium 3D tiles without exposing the key in the browser."""
    if not LANDSD_3D_API_KEY:
        raise HTTPException(503, "Lands Department 3D map key is not configured")
    if not tile_path.startswith("f2/") or ".." in Path(tile_path).parts:
        raise HTTPException(404, "Unknown Lands Department 3D tiles resource")
    upstream = f"https://data.map.gov.hk/api/3d-data/3dtiles/{tile_path}"
    params = dict(request.query_params)
    params["key"] = LANDSD_3D_API_KEY
    async with httpx.AsyncClient(timeout=45, follow_redirects=True) as client:
        response = await client.get(upstream, params=params)
    if response.is_error:
        raise HTTPException(response.status_code, "Lands Department 3D map request failed")
    from fastapi.responses import Response
    content_type = response.headers.get("content-type", "application/octet-stream")
    content = response.content
    if "json" in content_type:
        document = response.json()
        def proxy_tile_uris(value):
            if isinstance(value, dict):
                for key, item in value.items():
                    if key in {"uri", "url", "template"} and isinstance(item, str):
                        absolute = urljoin(upstream, item)
                        parsed = urlsplit(absolute)
                        if parsed.hostname == "data.map.gov.hk" and "/api/3d-data/3dtiles/f2/" in parsed.path:
                            tile = parsed.path.split("/api/3d-data/3dtiles/", 1)[1]
                            value[key] = urlunsplit(("", "", "/api/landsd-3d-tiles/" + tile, strip_api_key(parsed.query), parsed.fragment))
                    else:
                        proxy_tile_uris(item)
            elif isinstance(value, list):
                for item in value:
                    proxy_tile_uris(item)
        proxy_tile_uris(document)
        content = json.dumps(document, separators=(",", ":")).encode("utf-8")
    return Response(content, media_type=content_type)


def strip_api_key(query: str) -> str:
    """Remove credentials returned in upstream tile links before sending them to browsers."""
    return urlencode([(key, value) for key, value in parse_qsl(query, keep_blank_values=True) if key.lower() not in {"key", "api_key"}], doseq=True)


def decode_polyline(encoded: str) -> list[tuple[float, float]]:
    points, index, lat, lng = [], 0, 0, 0
    while index < len(encoded):
        values = []
        for _ in range(2):
            result, shift = 0, 0
            while True:
                byte = ord(encoded[index]) - 63
                index += 1
                result |= (byte & 0x1F) << shift
                shift += 5
                if byte < 0x20:
                    break
            values.append(~(result >> 1) if result & 1 else result >> 1)
        lat += values[0]
        lng += values[1]
        points.append((lat / 1e5, lng / 1e5))
    return points


def encode_polyline(points: list[tuple[float, float]]) -> str:
    """Encode latitude/longitude vertices for Google's compact Elevation path request."""
    previous_lat = previous_lng = 0
    output = []
    for latitude, longitude in points:
        lat, lng = round(latitude * 1e5), round(longitude * 1e5)
        for delta in (lat - previous_lat, lng - previous_lng):
            value = ~(delta << 1) if delta < 0 else delta << 1
            while value >= 0x20:
                output.append(chr((0x20 | (value & 0x1F)) + 63))
                value >>= 5
            output.append(chr(value + 63))
        previous_lat, previous_lng = lat, lng
    return "".join(output)


def haversine(a: tuple[float, float], b: tuple[float, float]) -> float:
    r = 6371008.8
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp, dl = math.radians(b[0] - a[0]), math.radians(b[1] - a[1])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


async def google_route(client: httpx.AsyncClient, origin: dict, dest: Destination) -> dict:
    body = {
        "origin": {"location": {"latLng": {"latitude": origin["latitude"], "longitude": origin["longitude"]}}},
        "destination": {"location": {"latLng": {"latitude": dest.latitude, "longitude": dest.longitude}}},
        "travelMode": "WALK",
        "computeAlternativeRoutes": False,
        "languageCode": "en",
        "units": "METRIC",
    }
    response = await client.post("https://routes.googleapis.com/directions/v2:computeRoutes", json=body, headers={"X-Goog-Api-Key": API_KEY, "X-Goog-FieldMask": "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline"})
    response.raise_for_status()
    routes = response.json().get("routes", [])
    if not routes:
        return {"id": dest.id, "accessible": False, "reason": "No walking route found"}
    route = routes[0]
    coords = decode_polyline(route["polyline"]["encodedPolyline"])
    if len(coords) > 512:
        stride = math.ceil((len(coords) - 1) / 511)
        coords = coords[::stride] + ([coords[-1]] if coords[-1] != coords[::stride][-1] else [])
    encoded_path = encode_polyline(coords)
    route_distance = float(route.get("distanceMeters", 0))
    # About one height sample per 5 m, capped at Google's 512 sample limit.
    samples_count = min(512, max(2, math.ceil(route_distance / 5) + 1))
    elev_response = await client.get("https://maps.googleapis.com/maps/api/elevation/json", params={"path": f"enc:{encoded_path}", "samples": samples_count, "key": API_KEY})
    elev_response.raise_for_status()
    elev = elev_response.json()
    if elev.get("status") != "OK" or not elev.get("results"):
        raise ValueError("Elevation API did not return route samples")
    samples = elev["results"]
    slopes = []
    for left, right in zip(samples, samples[1:]):
        a = (left["location"]["lat"], left["location"]["lng"])
        b = (right["location"]["lat"], right["location"]["lng"])
        distance = haversine(a, b)
        slopes.append(math.degrees(math.atan(abs(right["elevation"] - left["elevation"]) / max(distance, 0.5))))
    max_slope = max(slopes, default=0)
    path_coords = [[s["location"]["lng"], s["location"]["lat"], s["elevation"]] for s in samples]
    duration_s = int(float(str(route.get("duration", "0s")).rstrip("s")))
    return {"id": dest.id, "name": dest.name, "kind": dest.kind, "distance_m": route.get("distanceMeters", 0), "duration": route.get("duration"), "duration_s": duration_s, "max_slope_deg": round(max_slope, 1), "accessible": True, "path": path_coords, "elevations": [s["elevation"] for s in samples]}


@app.post("/api/analyze")
async def analyze(request: AnalyzeRequest):
    if not API_KEY:
        raise HTTPException(503, "Google Maps Platform key is not configured")
    origin = request.origin or ORIGIN
    semaphore = asyncio.Semaphore(6)
    async with httpx.AsyncClient(timeout=30) as client:
        async def analyze_destination(dest: Destination) -> dict:
            async with semaphore:
                try:
                    result = await google_route(client, origin, dest)
                    if result.get("duration_s", 0) > request.walk_time_seconds:
                        result.update(accessible=False, reason="Beyond selected walking-time threshold")
                    elif result.get("max_slope_deg", 0) > request.max_slope_deg:
                        result.update(accessible=False, reason="Route exceeds slope limit")
                    return result
                except (httpx.HTTPError, KeyError, ValueError) as exc:
                    return {"id": dest.id, "name": dest.name, "kind": dest.kind, "accessible": False, "reason": f"Route analysis unavailable: {exc}"}

        results = await asyncio.gather(*(analyze_destination(dest) for dest in request.destinations))
    return {"results": results, "origin": origin, "walk_time_seconds": request.walk_time_seconds, "max_slope_deg": request.max_slope_deg}


def walking_candidates(origin: dict[str, float], distance_m: int, spokes: int = 24) -> list[dict]:
    """Create Google-routed candidates that bracket the selected walking-time boundary."""
    points = []
    # Direct distance only seeds the matrix query; Google returns the actual
    # pedestrian duration for every candidate. The wide spacing makes it more
    # likely to bracket that duration even where the street network detours.
    fractions = (0.5, 0.8, 1.1, 1.5, 2.0)
    for spoke in range(spokes):
        bearing = 2 * math.pi * spoke / spokes
        for ring, fraction in enumerate(fractions):
            distance = min(7000, distance_m * fraction)
            north_m, east_m = distance * math.cos(bearing), distance * math.sin(bearing)
            latitude = origin["latitude"] + north_m / 111_320
            longitude = origin["longitude"] + east_m / (111_320 * math.cos(math.radians(origin["latitude"])))
            points.append({"spoke": spoke, "ring": ring, "distance_m": distance, "latitude": latitude, "longitude": longitude})
    return points


def seconds(value: str | None) -> int:
    try:
        return int(float(str(value or "0s").removesuffix("s")))
    except ValueError:
        return 0


@app.post("/api/isochrone")
async def isochrone(request: AnalyzeRequest):
    """Approximate a Google walking-time contour from matrix and slope-screened routes."""
    if not API_KEY:
        raise HTTPException(503, "Google Maps Platform key is not configured; the static preview does not show a fabricated circle")
    origin = request.origin or ORIGIN
    candidates = walking_candidates(origin, request.walk_time_seconds)
    matrix_request = {
        "origins": [{"waypoint": {"location": {"latLng": {"latitude": origin["latitude"], "longitude": origin["longitude"]}}}}],
        "destinations": [{"waypoint": {"location": {"latLng": {"latitude": p["latitude"], "longitude": p["longitude"]}}}} for p in candidates],
        "travelMode": "WALK",
        "languageCode": "en",
        "units": "METRIC",
    }
    headers = {"X-Goog-Api-Key": API_KEY, "X-Goog-FieldMask": "originIndex,destinationIndex,duration,distanceMeters,condition,status"}
    async with httpx.AsyncClient(timeout=45) as client:
        matrix_response = await client.post("https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix", json=matrix_request, headers=headers)
        if matrix_response.is_error:
            raise HTTPException(matrix_response.status_code, "Google walking route matrix request failed")
        try:
            matrix_data = matrix_response.json()
        except json.JSONDecodeError:
            # ComputeRouteMatrix may stream one JSON element per line instead
            # of wrapping the elements in a JSON array.
            matrix_data = [json.loads(line) for line in matrix_response.text.splitlines() if line.strip()]
        if isinstance(matrix_data, dict):
            matrix_data = matrix_data.get("elements", [])
        for item in matrix_data:
            index = item.get("destinationIndex")
            if index is None or not 0 <= index < len(candidates):
                continue
            candidates[index]["duration_s"] = seconds(item.get("duration"))
            candidates[index]["route_exists"] = item.get("condition") == "ROUTE_EXISTS" and item.get("status", {}).get("code", 0) == 0

        by_spoke: dict[int, list[dict]] = {i: [] for i in range(24)}
        for item in candidates:
            if item.get("route_exists"):
                by_spoke[item["spoke"]].append(item)

        semaphore = asyncio.Semaphore(6)
        async def find_spoke_edge(spoke: int):
            spoke_candidates = by_spoke[spoke]
            inside = [p for p in spoke_candidates if p.get("duration_s", 0) <= request.walk_time_seconds]
            outside = [p for p in spoke_candidates if p.get("duration_s", 0) > request.walk_time_seconds]
            attempts = []
            if inside and outside:
                inner = max(inside, key=lambda p: p["distance_m"])
                outer = min((p for p in outside if p["distance_m"] > inner["distance_m"]), key=lambda p: p["distance_m"], default=None)
                if outer and outer["duration_s"] > inner["duration_s"]:
                    fraction = (request.walk_time_seconds - inner["duration_s"]) / (outer["duration_s"] - inner["duration_s"])
                    fraction = max(0.0, min(1.0, fraction))
                    attempts.append({
                        "spoke": spoke,
                        "ring": "interpolated",
                        "distance_m": inner["distance_m"] + fraction * (outer["distance_m"] - inner["distance_m"]),
                        "latitude": inner["latitude"] + fraction * (outer["latitude"] - inner["latitude"]),
                        "longitude": inner["longitude"] + fraction * (outer["longitude"] - inner["longitude"]),
                    })
            # Re-route the interpolated point through Routes API to verify the
            # time estimate; if it crosses the threshold or fails the grade
            # screen, fall back to progressively shorter matrix candidates.
            attempts.extend(sorted(inside, key=lambda p: p["distance_m"], reverse=True))
            for candidate in attempts:
                async with semaphore:
                    dest = Destination(id=f"iso-{spoke}-{candidate['ring']}", name="Walking reach sample", latitude=candidate["latitude"], longitude=candidate["longitude"])
                    try:
                        route = await google_route(client, origin, dest)
                    except (httpx.HTTPError, KeyError, ValueError):
                        continue
                if route["duration_s"] <= request.walk_time_seconds and route["max_slope_deg"] <= request.max_slope_deg:
                    return {"spoke": spoke, "longitude": route["path"][-1][0], "latitude": route["path"][-1][1], "duration_s": route["duration_s"], "distance_m": route["distance_m"], "max_slope_deg": route["max_slope_deg"]}
            return None

        boundary = await asyncio.gather(*(find_spoke_edge(spoke) for spoke in range(24)))
    boundary = [point for point in boundary if point]
    if len(boundary) < 16:
        return {"feature": None, "boundary_samples": len(boundary), "requested_samples": 24, "walk_time_seconds": request.walk_time_seconds, "max_slope_deg": request.max_slope_deg, "message": "Too few slope-safe walking directions were found to draw a reliable contour."}
    coordinates = [[point["longitude"], point["latitude"]] for point in sorted(boundary, key=lambda p: p["spoke"])]
    coordinates.append(coordinates[0])
    feature = {"type": "Feature", "properties": {"method": "Google Routes walking-time matrix with interpolated and verified boundary routes; elevation-screened spokes", "sample_count": len(boundary), "walk_time_seconds": request.walk_time_seconds, "max_slope_deg": request.max_slope_deg}, "geometry": {"type": "Polygon", "coordinates": [coordinates]}}
    return {"feature": feature, "boundary_samples": len(boundary), "requested_samples": 24, "walk_time_seconds": request.walk_time_seconds, "max_slope_deg": request.max_slope_deg}


app.mount("/", StaticFiles(directory=ROOT / "static", html=True), name="site")
