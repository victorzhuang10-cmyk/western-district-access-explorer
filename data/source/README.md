# CSDI source snapshots

Retrieved 15 November 2026 for the Western District Age-Friendly Access Explorer. The files are original GeoJSON downloads from Hong Kong's Common Spatial Data Infrastructure (CSDI) Portal. Geometry is WGS84 per GeoJSON conventions; feature geometries in these two datasets are points.

- `public-open-space.geojson`: Lands Department, Public Open Space; source metadata updated 25 October 2026; 94 records. [CSDI dataset](https://portal.csdi.gov.hk/csdi-webpage/metadata/landsd_rcd_1637304969323_68704/html) · [download endpoint](https://portal.csdi.gov.hk/csdi-webpage/file-api?dataset_id=landsd_rcd_1637304969323_68704&format=geojson&layer_name=POS)
- `outdoor-fitness-equipment.geojson`: Leisure and Cultural Services Department, Outdoor Fitness Equipment; source file dated 8 October 2026; 684 records. [CSDI metadata](https://portal.csdi.gov.hk/csdi-webpage/metadata/lcsd_rcd_1670389505454_91091/html) · [download endpoint](https://portal.csdi.gov.hk/csdi-webpage/file-api?dataset_id=lcsd_rcd_1670389505454_91091&format=geojson&layer_name=geotagging)

The public web layer is a 4 km straight-line seed subset (24 open-space points and 40 fitness points) centered at Hill Court, 28 Hill Road. The seed extent only helps select route destinations. Walking-time contours are built from routed travel time and sampled grade in the app. The source records do not provide park boundaries or verify public entrances.

CSDI terms permit free use with source attribution and the applicable terms; acknowledge the Government of the HKSAR and the relevant data publisher when reusing these files. See the [CSDI Terms and Conditions](https://portal.csdi.gov.hk/csdi-webpage/doc/TNC).
