# Western District Age-Friendly Access Explorer

An interactive 3D walking-accessibility prototype for public green space and outdoor fitness facilities around the Western District Elderly Community Centre in Hong Kong.

## Open the site

- Public preview: <https://victorzhuang10-cmyk.github.io/western-district-access-explorer/map.html>
- Public source repository: <https://github.com/victorzhuang10-cmyk/western-district-access-explorer>

The preview uses an OpenStreetMap/OpenFreeMap 3D vector map with extruded buildings, Hong Kong CSDI destination points, and Lands Department 3D Pedestrian Route times, paths, and elevation samples. The 100 m–2 km slider is an equivalent walk-time budget at a 1 m/s reference pace (300 m = 5 minutes); route accessibility is screened by actual returned travel time and the 3–20° slope control. City, simplified 3D access-diagram, and 3D elevation-section presentations are selectable. The no-key contour samples 12 real 3D routes and apportions each total route time by path length to estimate the boundary; it is a planning approximation, not a complete isochrone. Open-space source records are points, not park parcel boundaries.

## Run the full app locally

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Add GOOGLE_MAPS_API_KEY to .env, then:
uvicorn app:app --reload
```

Open <http://127.0.0.1:8000>. The FastAPI service keeps the Google key on the server and can provide Google Routes walking directions, route elevation samples, a sampled walking-time contour, and Google Photorealistic 3D Tiles. Enable the Map Tiles API, Routes API, and Elevation API in the Google Cloud project and configure billing and key restrictions. Never commit `.env`.

GitHub Pages hosts only the static preview; it does not run FastAPI or provide server secrets. Google Photorealistic 3D Tiles and Google Routes are available only on a deployment with the backend and a configured key. The Pages preview calls the official Lands Department pedestrian-route service directly for its 3D route and elevation data.

## Deploy the Google-enabled app

The repository includes `render.yaml` for a same-origin FastAPI deployment. In Render, create a Blueprint from this public repository. Render will prompt for `GOOGLE_MAPS_API_KEY`; add the key there and keep it out of GitHub. Enable the Maps Tiles, Routes, and Elevation APIs in the matching Google Cloud project. The resulting `onrender.com` URL serves the interactive site and its `/api` endpoints together. The GitHub Pages URL remains the no-key Lands Department preview.

## Data workflow

`notebooks/prepare_access_data.ipynb` uses GeoPandas to inspect CSDI / GeoInfo and DATA.GOV.HK layers, project them to Hong Kong 1980 Grid (EPSG:2326), request the app's walking contour, clip green-space polygons and outdoor-fitness locations to that contour, and export web-ready GeoJSON. Download source records into `data/source/`, check the schema and CRS, verify the community-centre entrance, and record source URLs, retrieval dates, and licence metadata. The checked-in `static/data/access-points.geojson` contains a study-area subset of public CSDI records. Open-space records in this layer indicate locations, not full park boundaries.

Install the optional notebook tools with `pip install -r requirements-gis.txt`. The notebook expects the configured local API to provide a walking contour; it does not make Google API calls until you explicitly request and save that response.

## How the access screening works

The route services provide 3D geometry, walking distance, and travel time. The app estimates the steepest absolute elevation-sample angle as `atan(abs(Δelevation) / horizontal distance)`. The Google contour endpoint samples Google walking durations at five candidate distances along each of 24 directions, interpolates between the closest inside/outside travel-time candidates, then verifies the estimated edge with route geometry and elevation samples. The resulting slope-screened contour is still a sampled approximation, not a complete pedestrian-network isochrone; it can miss alleys, route alternatives, stairs, kerbs, crossing quality, surface condition, closures, and step-free entrances. Elevation resolution may miss short ramps or steps. Field checks and a verified pedestrian network are needed before product or policy decisions.

The 3D section is based on returned route elevation samples. Treat every result as exploratory, not as an accessibility certification. Lands Department routes require the map-face logo and copyright attribution shown in the interface. Google map data must retain required attribution and be used under the applicable Maps Platform terms.

## Sources

- Hong Kong GeoData Store / CSDI: <https://portal.csdi.gov.hk/>
- Lands Department 3D Pedestrian Route API: <https://portal.csdi.gov.hk/csdi-webpage/apidoc/3d-pedestrian-route-search>
- Lands Department 3D Pedestrian Network: <https://data.gov.hk/en-data/dataset/hk-landsd-openmap-3d-pedestrian-network>
- DATA.GOV.HK outdoor fitness equipment: <https://data.gov.hk/en-data/dataset/hk-lcsd-facility-facility-ofe>
- Lands Department public open space: <https://data.gov.hk/en-data/dataset/hk-landsd-openmap-public-open-space>
