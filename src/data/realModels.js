// Real, artist-made 3D models (downloaded from Sketchfab, compressed by `npm run models`
// into public/models/<slug>.glb). Licences and credits live in the database (assets table).
//   match     how to recognise the downloaded file
//   yaw       optional rotation fix so the car faces +X (null = detect from the tail lights)
//   paint     material name(s) that are the body paint (recoloured to the factory colour)
//   keepPaint keep the model's own paint colour (still gets the clear-coat finish)
//   flakes    false = no metallic-flake normal map on the paint (for models with odd UVs)
//   frontSide draw solid materials one-sided (models with doubled, inward-facing shells)
//   lamps     material name(s) of the lamp emitters lit at night
//   hide      object/material names to drop (logos, display stands...)
//   rx        overrides for the part-name patterns in src/three/realCar.js (RX)
// Wheels are found from where the tyres touch the ground, so models that merge all four
// wheels into one object (or wheels with bumpers) need no wheel patterns here.
export const REAL_MODELS = {
  'aventador-svj': {
    match: /aventador/i, yaw: null,
    paint: /^CARROSSERIE$/,
    lamps: /^LightEmissiveWhite$|^GlassRedLights$/,
    rx: {
      caliper: /brake|calip/i,
      interior: /intPlastic|intAlcantara|intTex|interior|seat|dashboard/i,
    },
  },
  'f8-tributo': {
    match: /f8/i, yaw: null,
  },
  '911-turbo-s': {
    // the tail-light test is fooled by the red-tinted front lamp glass
    match: /911|porsche/i, yaw: Math.PI / 2,
    paint: /^PorschePorsche_911TurboS992_2021RegionA1$/,
  },
  'chiron': {
    // exported with generic part names (Meshpart<n>Mtl): lamps picked by material
    match: /chiron/i, yaw: Math.PI,
    lamps: /^Meshpart(256|182)Mtl$/,
    rx: { light: /light|lamp|Meshpart(256|182|220|265)Mtl/i },
  },
  '720s': {
    match: /720s|mclaren/i, yaw: null,
  },
  'gt-r': {
    match: /gt-?r|skyline/i, yaw: null,
  },
  'mustang-gt': {
    match: /mustang/i, yaw: null,
  },
  'm4-competition': {
    match: /\bm4\b|bmw/i, yaw: null,
  },
  'model-s-plaid': {
    // game-style export: parts are named material_<n>; head and tail lamps picked by material
    // its texture coordinates are a colour palette layout, so the metallic-flake map would look like noise;
    // the body shell is doubled inside, which flickers in blotches when drawn double-sided
    match: /tesla|model_s|model s/i, yaw: Math.PI / 2, flakes: false, frontSide: true,
    lamps: /^material_(8|11|20|21)$/,
    rx: { light: /light|lamp|\bmaterial_(8|11|20|21)\b/i },
  },
  'thar': {
    // Maya/Arnold export with generic names: red panels, lamps and tail lights picked by material
    match: /thar/i, yaw: null,
    paint: /^aiStandardSurface(1|2|3|21|33|43|44)SG$/,
    lamps: /^aiStandardSurface(13|42)SG$/,
    rx: { light: /light|lamp|aiStandardSurface(11|13|37|42)SG/i },
  },
};
