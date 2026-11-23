-- RevEngine relational schema (runs in the browser with SQLite / sql.js)
PRAGMA foreign_keys = ON;

CREATE TABLE manufacturers (
  id        INTEGER PRIMARY KEY,
  name      TEXT    NOT NULL UNIQUE,
  country   TEXT    NOT NULL,
  founded   INTEGER NOT NULL
);

CREATE TABLE engines (
  id             INTEGER PRIMARY KEY,
  code           TEXT NOT NULL,
  layout         TEXT NOT NULL,          -- V12, V8, Flat-6, W16, Inline-6, Electric ...
  cylinders      INTEGER NOT NULL,       -- 0 for electric
  displacement_l REAL,                   -- NULL for electric
  aspiration     TEXT NOT NULL,          -- Naturally aspirated, Twin-turbo ...
  fuel           TEXT NOT NULL
);

CREATE TABLE cars (
  id              INTEGER PRIMARY KEY,
  slug            TEXT    NOT NULL UNIQUE,
  model           TEXT    NOT NULL,
  manufacturer_id INTEGER NOT NULL REFERENCES manufacturers(id),
  engine_id       INTEGER NOT NULL REFERENCES engines(id),
  year            INTEGER NOT NULL,
  body_style      TEXT    NOT NULL,
  engine_position TEXT    NOT NULL,      -- front, mid, rear, floor (EV)
  drivetrain      TEXT    NOT NULL,      -- RWD, AWD, 4WD
  gearbox         TEXT    NOT NULL,
  power_hp        INTEGER NOT NULL,
  torque_nm       INTEGER NOT NULL,
  top_speed_kmh   INTEGER NOT NULL,
  zero_100_s      REAL    NOT NULL,
  weight_kg       INTEGER NOT NULL,
  price_usd       INTEGER NOT NULL,
  seats           INTEGER NOT NULL,
  color_name      TEXT    NOT NULL,
  tagline         TEXT    NOT NULL
);

CREATE TABLE part_types (
  key         TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  system      TEXT NOT NULL,
  description TEXT NOT NULL
);

-- Many-to-many: which spec each car has for each part
CREATE TABLE car_parts (
  car_id   INTEGER NOT NULL REFERENCES cars(id),
  part_key TEXT    NOT NULL REFERENCES part_types(key),
  spec     TEXT    NOT NULL,
  PRIMARY KEY (car_id, part_key)
);

CREATE INDEX idx_cars_power ON cars(power_hp);
CREATE INDEX idx_cars_year  ON cars(year);

-- Handy joined view used by the Garage and Compare screens
CREATE VIEW car_overview AS
SELECT c.id, c.slug, c.model, m.name AS manufacturer, m.country, c.year,
       c.body_style, c.engine_position, c.drivetrain, c.gearbox,
       e.code AS engine_code, e.layout AS engine_layout, e.cylinders,
       e.displacement_l, e.aspiration, e.fuel,
       c.power_hp, c.torque_nm, c.top_speed_kmh, c.zero_100_s,
       c.weight_kg, c.price_usd, c.seats, c.color_name, c.tagline,
       ROUND(c.power_hp * 1000.0 / c.weight_kg, 1) AS hp_per_tonne
FROM cars c
JOIN manufacturers m ON m.id = c.manufacturer_id
JOIN engines e       ON e.id = c.engine_id;

-- Third-party assets used by the 3D scenes (licences require credit)
CREATE TABLE assets (
  id      INTEGER PRIMARY KEY,
  car_id  INTEGER REFERENCES cars(id),   -- NULL for location photos
  kind    TEXT NOT NULL,                 -- '3D model' or 'HDRI photo'
  title   TEXT NOT NULL,
  author  TEXT NOT NULL,
  license TEXT NOT NULL,
  source  TEXT NOT NULL,
  url     TEXT NOT NULL
);
