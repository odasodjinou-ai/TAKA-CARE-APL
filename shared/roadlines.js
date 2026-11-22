// Grille routière de base (module sans dépendance, pour éviter les imports circulaires).
export const WORLD = Object.freeze({
  bound: 420, // zone jouable : |x|,|z| <= bound
  roadStart: -180,
  roadStep: 60,
  roadCount: 7, // routes en x et z : -180..180
  roadWidth: 10,
  sidewalk: 3,
});

export const ROAD_LINES = Array.from({ length: WORLD.roadCount }, (_, i) => WORLD.roadStart + i * WORLD.roadStep);
