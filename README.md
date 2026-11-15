# Western District Age-Friendly Access Explorer

An interactive 3D walking-accessibility prototype for public green space and outdoor fitness facilities around the Western District Elderly Community Centre in Hong Kong.

## Open the site

- Public preview: <https://victorzhuang10-cmyk.github.io/western-district-access-explorer/>
- Public source repository: <https://github.com/victorzhuang10-cmyk/western-district-access-explorer>

The preview opens at Hill Court, 28 Hill Road, Sai Ying Pun, using the Western District Elderly Community Centre listing in Google Maps and the operator address. Its six presentation states combine a detailed or diagram 2D street map, 3D building massing, and a 3D walking-reach cutaway. The 3D reach view masks the surrounding city and highlights the walking-time contour, origin, routes, and reachable green-space / outdoor-fitness locations. A route elevation profile is also available. The Pages preview uses OpenStreetMap/OpenFreeMap buildings and Hong Kong CSDI destination points, with Lands Department 3D Pedestrian Route times, paths, and elevation samples. When configured, the server can load Google Photorealistic 3D Tiles or the official Lands Department 3D Visualisation tiles. The 100 m–2 km slider is an equivalent walk-time budget at a 1 m/s reference pace (300 m = 5 minutes); route accessibility is screened by actual returned travel time and the 3–20° slope control. The no-key contour samples 24 real 3D routes and apportions each total route time by path length to estimate the boundary; it is a planning approximation, not a complete isochrone. Open-space source records are points, not park parcel boundaries.

If you open a checked-out HTML file directly from Finder, it redirects to the public preview. The map needs a web server because browsers restrict its public data requests from `file://` pages.

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

GitHub Pages hosts only the static preview; it does not run FastAPI or provide server secrets. Google Photorealistic 3D Tiles and Google Routes are available only on a deployment with the backend and a configured key. The Pages preview calls the official Lands Department pedestrian-route service directly for its 3D route and elevation data. To use the official tiled 3D Visualisation Map, request a free API key from Lands Department at 3dmap@landsd.gov.hk and set `LANDSD_3D_MAP_API_KEY` in the Render service environment; the backend keeps that key out of browser code and proxies tile requests. Without this key, the 3D building massing view remains available.

## Deploy the Google-enabled app

The repository includes `render.yaml` for a same-origin FastAPI deployment. In Render, create a Blueprint from this public repository. Render will prompt for `GOOGLE_MAPS_API_KEY`; add the key there and keep it out of GitHub. Enable the Maps Tiles, Routes, and Elevation APIs in the matching Google Cloud project. The resulting `onrender.com` URL serves the interactive site and its `/api` endpoints together. The GitHub Pages URL remains the no-key Lands Department preview.

## Data workflow

`notebooks/prepare_access_data.ipynb` downloads the official Lands Department Public Open Space and LCSD Outdoor Fitness Equipment layers, uses GeoPandas to project them to Hong Kong 1980 Grid (EPSG:2326), buffers the verified centre to form a destination seed extent, and clips the point records to a saved routed walking contour before export. Download source records into `data/source/`, check the schema and CRS, verify the community-centre entrance, and record source URLs, retrieval dates, and licence metadata. The checked-in `static/data/access-points.geojson` contains 64 current CSDI destination points within a 4 km candidate extent, refreshed on 15 November 2026 from the Lands Department Public Open Space and LCSD Outdoor Fitness Equipment datasets. The 4 km seed extent supplies destinations for a 2 km walking-time setting; routed time and slope determine the displayed reach. Distances are recomputed from the verified Hill Court pin so precomputed values from the earlier approximate origin do not affect route selection. The current CSDI open-space and outdoor-fitness layers provide point locations, not park parcel boundaries or facility entrance geometry.

Install the optional notebook tools with `pip install -r requirements-gis.txt`. The notebook expects the configured local API to provide a walking contour; it does not make Google API calls until you explicitly request and save that response.

## How the access screening works

The route services provide 3D geometry, walking distance, and travel time. The app estimates the steepest absolute elevation-sample angle as `atan(abs(Δelevation) / horizontal distance)`. The Google contour endpoint samples Google walking durations at five candidate distances along each of 24 directions, interpolates between the closest inside/outside travel-time candidates, then verifies the estimated edge with route geometry and elevation samples. The resulting slope-screened contour is still a sampled approximation, not a complete pedestrian-network isochrone; it can miss alleys, route alternatives, stairs, kerbs, crossing quality, surface condition, closures, and step-free entrances. Elevation resolution may miss short ramps or steps. Field checks and a verified pedestrian network are needed before product or policy decisions.

The 3D section is based on returned route elevation samples. The detailed 3D tile modes need either the configured Google key or LandsD 3D Visualisation API key; the static GitHub Pages preview does not include server secrets. Treat every result as exploratory, not as an accessibility certification. Lands Department routes require the map-face logo and copyright attribution shown in the interface. Google map data must retain required attribution and be used under the applicable Maps Platform terms.

## Sources

- Hong Kong GeoData Store / CSDI: <https://portal.csdi.gov.hk/>
- Lands Department 3D Pedestrian Route API: <https://portal.csdi.gov.hk/csdi-webpage/apidoc/3d-pedestrian-route-search>
- Lands Department 3D Pedestrian Network: <https://data.gov.hk/en-data/dataset/hk-landsd-openmap-3d-pedestrian-network>
- DATA.GOV.HK outdoor fitness equipment: <https://data.gov.hk/en-data/dataset/hk-lcsd-facility-facility-ofe>
- Lands Department public open space: <https://data.gov.hk/en-data/dataset/hk-landsd-openmap-public-open-space>

## Verified centre location

Google Maps lists the Western District Elderly Community Centre at Hill Court, 28 Hill Road, Shek Tong Tsui, with map pin 22.2855625, 114.1347709. The operator and Hong Kong Social Welfare Department also list Shop A–E, G/F, Hill Court, 28 Hill Road.

- [Google Maps listing](https://www.google.com/maps/place/Western+District+Elderly+Community+Centre/@22.2855625,114.1347709,17z/)
- [Operator address](https://www.skhwc.org.hk/en/services/elderly/)
- [Social Welfare Department service directory](https://www.swd.gov.hk/en/pubsvc/district/cwsi/infobook2/)
- [Lands Department 3D Visualisation Map API](https://portal.csdi.gov.hk/csdi-webpage/apidoc/3d-visualisation-map-api)
