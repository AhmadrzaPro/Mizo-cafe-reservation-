// Floor studio: visual furniture is derived from existing table records.
export function tableFurniture(t) {
  const count = Math.max(1, Math.min(20, Number(t.capacity) || 1));
  return Array.from({ length: count }, (_, i) => {
    let x, y, angle;
    if (t.shape === "round") {
      angle = (i * 360) / count - 90;
      const r = (angle * Math.PI) / 180;
      x = 50 + 53 * Math.cos(r);
      y = 50 + 53 * Math.sin(r);
    } else {
      const top = Math.ceil(count / 2),
        bottom = count - top,
        isTop = i < top,
        j = isTop ? i : i - top,
        n = isTop ? top : bottom;
      x = ((j + 1) * 100) / (n + 1);
      y = isTop ? -3 : 103;
      angle = isTop ? -90 : 90;
    }
    return `<i class="furniture-chair" aria-hidden="true" style="left:${x}%;top:${y}%;--chair-angle:${angle + 90}deg"></i>`;
  }).join("");
}
