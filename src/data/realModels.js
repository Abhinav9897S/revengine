// Real, artist-made 3D models (downloaded from Sketchfab, compressed by `npm run models`
// into public/models/<slug>.glb). Licences and credits live in the database (assets table).
//   match  how to recognise the downloaded file
//   yaw    optional rotation fix so the car faces +X
//   paint  material name(s) that are the body paint (recoloured to the factory colour)
//   lamps  material name(s) of the lamp emitters lit at night
//   hide   object/material names to drop (logos, display stands...)
//   rx     overrides for the part-name patterns in src/three/realCar.js (RX)
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
    match: /911|porsche/i, yaw: null,
  },
  'chiron': {
    match: /chiron/i, yaw: null,
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
    match: /tesla|model_s|model s/i, yaw: null,
  },
  'thar': {
    match: /thar/i, yaw: null,
  },
};
