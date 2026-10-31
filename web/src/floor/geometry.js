export function fitFloorZoom(bounds, width, height) {
  return Math.max(
    0.02,
    Math.min(
      1,
      (Math.max(80, width) - 64) / bounds.width,
      (Math.max(80, height) - 64) / bounds.height,
    ),
  );
}
