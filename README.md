# RevEngine: Interactive 3D Car Showroom

A 3D car showroom styled like a car advert. Ten real cars sit in real photographed locations. Hover any part of a car to highlight it, click to zoom in and split it into labelled pieces, click the bonnet to switch on X-ray vision and lift the engine out, or press **C** for Ad mode, a looping car-commercial camera.

Built for the **Database & Web Systems** course (G1 batch): Abhinav Singh, Aarav Singh, Aryaman Gora.

## Run it

```powershell
npm install
npm run dev
```

Open http://localhost:5173 and press **Enter**.

To build a static version you can host anywhere (GitHub Pages, Netlify, college server):

```powershell
npm run build
npm run preview
```

The `dist/` folder is the whole website.

## Adding the real 3D car models

The hyper-real cars are artist-made models from Sketchfab (free, but you need a Sketchfab account to download). Until a model is imported, that car uses its code-built "blueprint" version.

1. Open each link in the **Credits** list below, click **Download 3D Model** and choose **GLB** (the zipped glTF also works). Leave the files in your Downloads folder.
2. Run:

```powershell
npm run models
```

The importer finds each car in Downloads, compresses it (Meshopt geometry, WebP textures) into `public/models/`, and updates `public/models/manifest.json`. Reload the page: imported cars show a **3D** badge.

The loader (`src/three/realCar.js`) then:

- scales the model to the car's real length and turns it to face forward
- upgrades materials: clear-coat paint with metallic flake, tinted glass, chrome, rubber
- finds the parts by name and position: wheels (split per corner if needed), doors with hinges, bonnet/engine cover, lights, wing, exhaust and cabin
- adds the code-built engine, chassis and exhaust inside the body for X-ray mode

If a model faces the wrong way, set `yaw` for that car in `src/data/realModels.js`.

## Locations

Real 360° HDR photos from Poly Haven (CC0) light the car, appear in its reflections, and are projected onto the ground it stands on.

| Location | Photo | Extras |
| --- | --- | --- |
| Rooftop car park, twilight | rooftop_night | headlights on |
| Neon riverside, night | shanghai_bund | rain, headlight beams |
| Desert highway, midday | nowhere_road | sun shadows from the photo's sun |
| Underground garage | parking_garage | headlights on |
| Studio reveal | studio_small_09 | infinity cove, softboxes, mirror floor |

Switch with the **Location** button or the `L` key.

## What you can do

| Action | How |
| --- | --- |
| Orbit / zoom | Drag / scroll |
| Highlight a part | Hover it (cyan glow and name tag) |
| Split a part apart | Click it: wheels, doors, lights, wing, exhaust, cabin, chassis |
| X-ray engine | Click the **bonnet** (or engine cover): the body turns to a ghost, the engine rises and splits apart with labels |
| Ad mode | `C`: commercial camera shots, letterbox, depth of field, title cards |
| Change location | `L` |
| Explode the whole car | `E` |
| X-ray on/off | `X` |
| Next / previous car | `→` / `←` (the car drives off and the next one drives in) |
| Back / reset | `Esc` or `R` |
| Garage | Filter and sort cars with live SQL |
| Compare | Head-to-head stats from a SQL JOIN |
| SQL Lab | Write your own SQL against the database |
| Credits | Model and photo licences, read from the `assets` table |

## Rendering

| Layer | Tech |
| --- | --- |
| Lighting | Image-based lighting from real HDR photos, sun direction measured from the photo, PCF sun shadows |
| Ground | Ground-projected 360° photo (GroundedSkybox), blurred contact shadows, ambient occlusion (GTAO) |
| Camera | Depth of field (Bokeh), Ad-mode shot list, cinematic 2.39:1 letterbox |
| Film look | Khronos PBR Neutral tone mapping, colour grade, subtle chromatic aberration, vignette, grain, bloom |
| Night | Headlight light pools and beams, rain |
| Models | glTF + Meshopt + WebP, BVH-accelerated picking (three-mesh-bvh) |

## Tech stack

Three.js (WebGL), GSAP, SQLite compiled to WebAssembly (sql.js), Web Audio API (synthesised engine sounds), Vite, gltf-transform + sharp (model compression).

## Database design

`src/db/schema.sql` and `src/db/seed.sql`

- `manufacturers` 1 → N `cars`
- `engines` 1 → N `cars`
- `cars` N ↔ M `part_types` through `car_parts` (each car's spec for each part)
- `assets`: credits and licences for every 3D model and photo (LEFT JOIN to `cars`)
- `car_overview` view joins everything and computes `hp_per_tonne`
- Indexes on `power_hp` and `year`

## Credits

| Car | Model | Author | Licence |
| --- | --- | --- | --- |
| Lamborghini Aventador SVJ | [Lamborghini Aventador SVJ SDC (FREE)](https://sketchfab.com/3d-models/784e4656aca649cca55d6b18740a19b2) | Lambo_SC04 | CC BY 4.0 |
| Ferrari F8 Tributo | [2020 Ferrari F8 Tributo](https://sketchfab.com/3d-models/8a86c4d634f64f8b8ee836bc93fa6ac8) | ddiaz-design | CC BY-NC-SA 4.0 |
| Porsche 911 Turbo S | [2021 Porsche 911 Turbo S (992)](https://sketchfab.com/3d-models/b6756fc06654405a839bf14e931e4c83) | ddiaz-design | CC BY-NC-SA 4.0 |
| Bugatti Chiron | [2023 Bugatti Chiron Profilée](https://sketchfab.com/3d-models/6da5092ee455446cb050e4c6b4a3ac05) | supercarmodels | CC BY 4.0 |
| McLaren 720S | [2019 McLaren 720S Spider](https://sketchfab.com/3d-models/d598b285dbc4408591c98aaf80648074) | ddiaz-design | CC BY 4.0 |
| Nissan GT-R | [Nissan Skyline GTR r35](https://sketchfab.com/3d-models/7b142ea3376e4811a326256c59bbc7a2) | BlackSnow02 | CC BY 4.0 |
| Ford Mustang GT | [2024 Ford Mustang GT](https://sketchfab.com/3d-models/16f0753d26a04a089223f2d9107a777f) | ddiaz-design | CC BY-NC-SA 4.0 |
| BMW M4 Competition | [2021 BMW M4 Competition (G82)](https://sketchfab.com/3d-models/b16d7a4d771e4abd85ce4e29d41402ed) | ddiaz-design | CC BY-NC-SA 4.0 |
| Tesla Model S Plaid | [2022 Tesla Model S Plaid](https://sketchfab.com/3d-models/d55cd7890b38470bb00a244ec6bea813) | shreyanshchaurasia13 | CC BY 4.0 |
| Mahindra Thar | [THAR 4X4](https://sketchfab.com/3d-models/66ee970b18014c98a1750064b65657b0) | MB_Mahesh | CC BY 4.0 |

Location photos: [Poly Haven](https://polyhaven.com) (CC0). Specs are approximate public manufacturer figures. The NC (non-commercial) licences allow this student project; don't sell it.

## Project layout

```
index.html              page shell (HUD, overlays, loader)
src/main.js             boot: database → location → cars → thumbnails → start
src/styles.css          HUD styling
src/db/                 schema.sql, seed.sql, db.js (queries)
src/data/designs.js     dimensions and blueprint shapes of the 10 cars
src/data/realModels.js  how to recognise each downloaded model
src/three/
  atmosphere.js         photo locations, sun, contact shadows, studio, headlights, rain
  realCar.js            loads a real model and rigs its parts
  carBuilder.js         blueprint cars (fallback + X-ray internals)
  engineBuilder.js      V / inline / flat / W engines and the EV drivetrain
  showroom.js           hover, click, explode, X-ray, labels, camera, car switching
  cinema.js             Ad mode shot list
  stage.js              renderer, camera, post-processing
  materials.js          shared materials, X-ray shader
src/ui/                 HUD, garage, compare, SQL lab, credits, synthesised sound
tools/                  import-models.mjs, optimize-model.mjs
public/env/             HDR photos and backgrounds
public/models/          compressed car models + manifest.json
```

Add `?q=low` to the URL on slower laptops (turns off ambient occlusion, the mirror floor and some effects).
