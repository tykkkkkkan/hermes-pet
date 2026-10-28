const REGION_ORDER = ['head', 'face', 'body', 'feet'];

function isFiniteNumber(value) {
  return Number.isFinite(Number(value));
}

function contains(area, x, y) {
  return area
    && isFiniteNumber(area.left)
    && isFiniteNumber(area.top)
    && isFiniteNumber(area.right)
    && isFiniteNumber(area.bottom)
    && x >= Number(area.left)
    && x <= Number(area.right)
    && y >= Number(area.top)
    && y <= Number(area.bottom);
}

function hitRegion(x, y, regions = {}) {
  const px = Number(x);
  const py = Number(y);
  if (!Number.isFinite(px) || !Number.isFinite(py) || px < 0 || py < 0 || px > 1 || py > 1) {
    return null;
  }
  return REGION_ORDER.find((zone) => contains(regions[zone], px, py)) || null;
}

module.exports = { REGION_ORDER, hitRegion };
