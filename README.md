# Western District Age-Friendly Access Explorer

An interactive 3D walking-accessibility prototype for exploring public green space and outdoor fitness equipment around the Western District Elderly Community Centre in Hong Kong.

## Run locally

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app:app --reload
```

Open <http://127.0.0.1:8000>. Without a Google Maps Platform key, the page renders a real OpenFreeMap/OpenStreetMap vector basemap with extruded 3D buildings in MapLibre GL JS. The bundled destination points and walking paths are illustrative until replaced with verified GeoJSON and live routing. Configure `GOOGLE_MAPS_API_KEY` in `.env` to enable Google's walking routes, elevation sampling, and Photorealistic 3D Tiles. Enable the Map Tiles API, Routes API, and Elevation API in the associated Google Cloud project, set billing, and restrict the key to this app's server IP / APIs. Do not commit `.env`.

## Data workflow

`notebooks/prepare_access_data.ipynb` shows how to read Hong Kong GeoInfo / CSDI GeoJSON layers with GeoPandas, project them to Hong Kong 1980 Grid (EPSG:2326) for metric buffers and spatial operations, and export web-ready GeoJSON. The included points are fictional and for interface demonstration only. Download current green-space and outdoor-fitness layers from the [Hong Kong GeoData Store](https://portal.csdi.gov.hk/) or [DATA.GOV.HK Outdoor Fitness Equipment](https://data.gov.hk/en-data/dataset/hk-lcsd-facility-facility-ofe/resource/75a32704-f3d7-4a53-935e-b946fc8c8078), then replace the sample file using the notebook.

## Accessibility method and limits

The Google integration requests pedestrian routes from the configured origin to each selected feature. It screens the returned route by distance and maximum absolute grade between sampled elevation points. The grade angle is `atan(abs(Δelevation) / horizontal segment distance)`. A route is shown only when its walking distance is within the selected radius and every sampled segment is at or below the selected grade limit. Elevation sampling is approximate; it does not identify stairs, kerbs, crossing quality, surface condition, lift outages, or step-free entrances. Treat this as an exploratory screening tool, not an accessibility certification. Use surveyed pedestrian network/elevation and field checks before making decisions.

The current implementation requests direct routes to points; it does not yet compute a full pedestrian-network isochrone or optimize alternate paths around steep segments. Google route/elevation data are subject to Google Maps Platform terms and attribution requirements. Hong Kong open-data layers retain their source metadata in the notebook.

## GitHub

Project repository: <https://github.com/victorzhuang10-cmyk/western-district-access-explorer>. The local `main` branch tracks `origin/main`.

The GitHub Pages workflow publishes the `static/` folder as a shareable interactive preview. It includes the live OpenFreeMap 3D buildings layer and illustrative sample destinations/routes. GitHub Pages does not run the FastAPI backend, so Google routing, elevation screening, Google Photorealistic 3D Tiles, and server-loaded GeoJSON require the full local/server deployment above. Set the Pages source to **GitHub Actions** in repository settings if it has not been configured already.
