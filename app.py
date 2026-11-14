"""Small API for Google Maps Platform routing and 3D tile sessions."""
from __future__ import annotations

import math
import os
from pathlib import Path

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

load_dotenv()
ROOT = Path(__file__).parent
API_KEY = os.getenv("GOOGLE_MAPS_API_KEY", "").strip()
ORIGIN = {"latitude": float(os.getenv("ORIGIN_LAT", "22.2833")), "longitude": float(os.getenv("ORIGIN_LNG", "114.1285"))}
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
    destinations: list[Destination] = Field(default_factory=list, max_length=40)
    radius_m: int = Field(300, ge=100, le=2000)
    max_slope_deg: float = Field(10, ge=3, le=20)


@app.get("/")
async def index():
    return FileResponse(ROOT / "static" / "index.html")


@app.get("/api/config")
async def config():
    return {"google_enabled": bool(API_KEY), "origin": ORIGIN}


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
    params = dict(request.query_params)
    params["key"] = API_KEY
    url = f"https://tile.googleapis.com/{tile_path}"
    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        response = await client.get(url, params=params)
    if response.is_error:
        raise HTTPException(response.status_code, "Google Map Tiles API request failed")
    from fastapi.responses import Response
    return Response(response.content, media_type=response.headers.get("content-type", "application/octet-stream"))


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
    path = "|".join(f"{lat},{lng}" for lat, lng in coords)
    elev_response = await client.get("https://maps.googleapis.com/maps/api/elevation/json", params={"path": path, "samples": min(512, max(2, len(coords))), "key": API_KEY})
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
    return {"id": dest.id, "name": dest.name, "kind": dest.kind, "distance_m": route.get("distanceMeters", 0), "duration": route.get("duration"), "max_slope_deg": round(max_slope, 1), "accessible": max_slope <= 20, "path": path_coords, "elevations": [s["elevation"] for s in samples]}


@app.post("/api/analyze")
async def analyze(request: AnalyzeRequest):
    if not API_KEY:
        raise HTTPException(503, "Google Maps Platform key is not configured; demo routes are shown in the browser")
    origin = request.origin or ORIGIN
    results = []
    async with httpx.AsyncClient(timeout=30) as client:
        for dest in request.destinations:
            try:
                result = await google_route(client, origin, dest)
                if result.get("distance_m", 0) > request.radius_m:
                    result.update(accessible=False, reason="Beyond selected walking radius")
                elif result.get("max_slope_deg", 0) > request.max_slope_deg:
                    result.update(accessible=False, reason="Route exceeds slope limit")
                results.append(result)
            except (httpx.HTTPError, KeyError, ValueError) as exc:
                results.append({"id": dest.id, "name": dest.name, "kind": dest.kind, "accessible": False, "reason": f"Route analysis unavailable: {exc}"})
    return {"results": results, "origin": origin, "radius_m": request.radius_m, "max_slope_deg": request.max_slope_deg}
