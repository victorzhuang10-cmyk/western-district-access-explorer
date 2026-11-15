# Western District Age-Friendly Access Explorer

An interactive 3D walking-accessibility prototype for public green space and outdoor fitness facilities around the Western District Elderly Community Centre in Hong Kong.

## Open the site

- Public preview: <https://victorzhuang10-cmyk.github.io/western-district-access-explorer/map-preview-nearby-seed-02.html?v=block-intersections-02>
- Public source repository: <https://github.com/victorzhuang10-cmyk/western-district-access-explorer>

The preview opens at Hill Court, 28 Hill Road, Sai Ying Pun. Three map presentations each have two styles: 2D City uses a colored street map or a simplified diagram; 3D City uses detailed map styling or building massing, with walking routes; 3D Reach shows the clipped pedestrian-network area, highlighted routes, and nearby building context. The displayed reach polygon is the sampled route boundary unioned with complete OpenFreeMap building footprints touched by that boundary. In 2D the translucent fill is drawn below building footprints; in the carved 3D diagram the snapped buffer and edge remain visible, with buildings intersecting reach jade and all others white in one extrusion layer. A touched footprint is a candidate block, not confirmation of an accessible entrance. The opening view is the detailed 2D City. The public preview uses the Lands Department 3D Pedestrian Route service for times, paths, and elevation samples and does not require Google Maps billing. When configured on the server, the app can show official Lands Department 3D Visualisation tiles; the public static page falls back to OpenFreeMap buildings. The 100 m–2 km slider is a walking-time budget at a 1 m/s reference pace (300 m = 5 minutes). There is no official buffer polygon in the source data: the app requests 3D pedestrian routes toward 24 targets at bearings 15° apart, trims each path at the time or grade limit, and connects the reached endpoints to make an estimated area. Failed directions remain gaps, so this is not a complete pedestrian-network isochrone. Destination routes are screened separately and may extend outside this coarse polygon. The two grade controls screen overall start-to-end route grade (3–80°) and the steepest grade between consecutive 3D samples (0–60°). Source open-space and outdoor-fitness records are points, not park parcel boundaries.

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

## Google Maps Platform cost

Google Maps Platform is pay-as-you-go. You can stay within the monthly free usage caps at low usage, but Google requires billing to be enabled for these APIs. Current global USD pricing lists these per-SKU monthly free caps and first paid tier:

| API / SKU used by the Google-backed map | Free monthly billable events | First paid tier |
| --- | ---: | ---: |
| Photorealistic 3D Tiles | 1,000 returned 3D tile requests | $6 per 1,000 |
| Compute Routes Essentials | 10,000 successful requests | $5 per 1,000 |
| Compute Route Matrix Essentials | 10,000 returned matrix elements | $5 per 1,000 |
| Elevation | 5,000 successful requests | $5 per 1,000 |

These are separate SKU allowances; tile usage is counted per returned tile, not per map view, so the number of tiles and eventual charge depends on how visitors pan, zoom, and load the 3D scene. At the default 300 m reach setting, the current contour calculation can use about 120 matrix elements plus up to 24 route and 24 elevation calls for the contour, with additional route/elevation calls for destination labels. Retries and the number of nearby places change the total. Set daily API quotas in Google Cloud and check the live [Google Maps Platform price list](https://developers.google.com/maps/billing-and-pricing/pricing) and [Routes billing rules](https://developers.google.com/maps/documentation/routes/usage-and-billing) before opening the key to public traffic. These are current global rates; account region and applicable SKU features can change billing.

## Deploy the Google-enabled app

The repository includes `render.yaml` for a same-origin FastAPI deployment. Use this button to create the free Render service from the public repository:

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/victorzhuang10-cmyk/western-district-access-explorer)

Render will prompt for `GOOGLE_MAPS_API_KEY`; enter it in Render and keep it out of GitHub. Enable the Maps Tiles, Routes, and Elevation APIs in the matching Google Cloud project. The resulting `onrender.com` URL serves the interactive site and its `/api` endpoints together. GitHub Pages remains the no-key Lands Department preview. To enable the optional official Lands Department detailed 3D tiles, add `LANDSD_3D_MAP_API_KEY` to the Render service environment separately.

## Data workflow

`notebooks/prepare_access_data.ipynb` downloads the official Lands Department Public Open Space and LCSD Outdoor Fitness Equipment layers, uses GeoPandas to project them to Hong Kong 1980 Grid (EPSG:2326), buffers the verified centre to form a destination seed extent, and clips the point records to a saved routed walking contour before export. Download source records into `data/source/`, check the schema and CRS, verify the community-centre entrance, and record source URLs, retrieval dates, and licence metadata. The checked-in `static/data/access-points.geojson` contains 64 current CSDI destination points within a 4 km candidate extent, refreshed on 15 November 2026 from the Lands Department Public Open Space and LCSD Outdoor Fitness Equipment datasets. The 4 km seed extent supplies destinations for a 2 km walking-time setting; routed time and slope determine the displayed reach. Distances are recomputed from the verified Hill Court pin so precomputed values from the earlier approximate origin do not affect route selection. The current CSDI open-space and outdoor-fitness layers provide point locations, not park parcel boundaries or facility entrance geometry.

Install the optional notebook tools with `pip install -r requirements-gis.txt`. The notebook expects the configured local API to provide a walking contour; it does not make Google API calls until you explicitly request and save that response.

## How the access screening works

The route services provide 3D geometry, walking distance, and travel time. The app calculates overall route grade from the net start-to-end elevation change and route length; it calculates local grade between consecutive elevation samples. Google-backed analysis and the no-key Lands Department preview screen both measures, alongside walking time. The public preview samples 24 pedestrian-network bearings at 15-degree spacing and retries closer targets when a distant target has no connected route. It constructs sectors from the resulting route-time boundary samples, rather than drawing an equal-distance circle. Route paths are cached by origin and candidate target. The 24-direction contour remains an approximation; it can miss alternate routes, stairs, kerbs, crossing quality, surface condition, closures, and step-free entrances. The sample-to-sample grade is limited by the Lands Department network's elevation vertices and does not model an elder's actual stride. Field checks remain necessary.

The 3D section is based on returned route elevation samples. The detailed 3D tile modes need either the configured Google key or LandsD 3D Visualisation API key; the static GitHub Pages preview does not include server secrets. Treat every result as exploratory, not as an accessibility certification. Lands Department routes require the map-face logo and copyright attribution shown in the interface. Google map data must retain required attribution and be used under the applicable Maps Platform terms.

## Sources

- Hong Kong GeoData Store / CSDI: <https://portal.csdi.gov.hk/>
- Lands Department 3D Pedestrian Route API: <https://portal.csdi.gov.hk/csdi-webpage/apidoc/3d-pedestrian-route-search>
- Lands Department 3D Pedestrian Network: <https://data.gov.hk/en-data/dataset/hk-landsd-openmap-3d-pedestrian-network>
- AMap routes documentation (overseas Web Service access requires prior authorization): <https://lbs.amap.com/api/web-service/guide/routes>
- DATA.GOV.HK outdoor fitness equipment: <https://data.gov.hk/en-data/dataset/hk-lcsd-facility-facility-ofe>
- Lands Department public open space: <https://data.gov.hk/en-data/dataset/hk-landsd-openmap-public-open-space>

## Verified centre location

Google Maps lists the Western District Elderly Community Centre at Hill Court, 28 Hill Road, Shek Tong Tsui, with map pin 22.2855625, 114.1347709. The operator and Hong Kong Social Welfare Department also list Shop A–E, G/F, Hill Court, 28 Hill Road.

- [Google Maps listing](https://www.google.com/maps/place/Western+District+Elderly+Community+Centre/@22.2855625,114.1347709,17z/)
- [Operator address](https://www.skhwc.org.hk/en/services/elderly/)
- [Social Welfare Department service directory](https://www.swd.gov.hk/en/pubsvc/district/cwsi/infobook2/)
- [Lands Department 3D Visualisation Map API](https://portal.csdi.gov.hk/csdi-webpage/apidoc/3d-visualisation-map-api)
