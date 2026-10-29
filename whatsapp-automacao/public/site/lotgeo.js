// Geometria dos mapas de loteamento, usada no site, no painel e no servidor.
// Os pontos estão em % da planta (0 a 100 nos dois eixos). Como a planta raramente
// é quadrada, as contas de distância usam a proporção real (largura / altura).
(function (root) {
  const dist = ([ax, ay], [bx, by], ratio = 1) => Math.hypot((bx - ax) * ratio, by - ay);
  const lerp = ([ax, ay], [bx, by], t) => [ax + (bx - ax) * t, ay + (by - ay) * t];
  const round = (v) => Math.round(v * 100) / 100;

  /** Linha com vários pontos (reta ou curva) dividida em n partes de mesmo comprimento: n + 1 pontos. */
  function resample(line, n, ratio = 1) {
    const segs = [];
    let total = 0;
    for (let i = 1; i < line.length; i++) {
      const len = dist(line[i - 1], line[i], ratio);
      segs.push(len);
      total += len;
    }
    const out = [line[0]];
    for (let k = 1; k < n; k++) {
      let want = (total * k) / n;
      let i = 0;
      while (i < segs.length - 1 && want > segs[i]) want -= segs[i++];
      out.push(lerp(line[i], line[i + 1], segs[i] ? want / segs[i] : 0));
    }
    out.push(line[line.length - 1]);
    return out;
  }

  /**
   * Quadra desenhada pelos dois lados compridos (A e B, no mesmo sentido). Cada lado
   * pode ser reta (2 cliques) ou curva (vários cliques): os lotes acompanham o formato.
   * rows = 1: os lotes vão de A até B. rows = 2: lotes de frente para A e de frente
   * para B, costas com costas (divididos pela linha do meio).
   * numbering 'u': a 2ª fileira volta no sentido contrário (como em muitas plantas).
   */
  function stripLots({ sideA, sideB, perRow, rows = 1, start = 1, numbering = 'u', ratio = 1 }) {
    const n = Math.max(1, Math.min(80, Math.round(Number(perRow) || 1)));
    if (!sideA || !sideB || sideA.length < 2 || sideB.length < 2) return [];
    const a = resample(sideA, n, ratio);
    const b = resample(sideB, n, ratio);
    const bands = Number(rows) === 2 ? [[a, a.map((p, i) => lerp(p, b[i], 0.5))], [a.map((p, i) => lerp(p, b[i], 0.5)), b]] : [[a, b]];
    const lots = [];
    let num = Number(start) || 1;
    bands.forEach(([f, g], r) => {
      const order = [...Array(n).keys()];
      if (r === 1 && numbering === 'u') order.reverse();
      for (const i of order) {
        lots.push({ number: String(num++), row: r + 1, shape: [f[i], f[i + 1], g[i + 1], g[i]].map(([x, y]) => [round(x), round(y)]) });
      }
    });
    return lots;
  }

  /** Área do polígono (em % ², corrigida pela proporção) e centro de massa. */
  function polyInfo(shape, ratio = 1) {
    let area = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < shape.length; i++) {
      const [x0, y0] = shape[i];
      const [x1, y1] = shape[(i + 1) % shape.length];
      const c = x0 * y1 - x1 * y0;
      area += c;
      cx += (x0 + x1) * c;
      cy += (y0 + y1) * c;
    }
    if (Math.abs(area) < 1e-9) {
      const avg = shape.reduce(([sx, sy], [x, y]) => [sx + x / shape.length, sy + y / shape.length], [0, 0]);
      return { area: 0, center: avg };
    }
    return { area: Math.abs(area / 2) * ratio, center: [cx / (3 * area), cy / (3 * area)] };
  }

  /** Caminho SVG do polígono com os cantos arredondados (raio proporcional ao lote). */
  function roundedPath(shape, ratio = 1, k = 0.18) {
    const n = shape.length;
    if (n < 3) return '';
    const P = shape.map(([x, y]) => [x * ratio, y]);
    const out = (x, y) => `${round(x / ratio)} ${round(y)}`;
    let d = '';
    for (let i = 0; i < n; i++) {
      const prev = P[(i - 1 + n) % n];
      const cur = P[i];
      const next = P[(i + 1) % n];
      const r = Math.min(dist(prev, cur), dist(cur, next)) * k;
      const p1 = lerp(cur, prev, r / (dist(cur, prev) || 1));
      const p2 = lerp(cur, next, r / (dist(cur, next) || 1));
      d += `${i ? 'L' : 'M'}${out(...p1)} Q${out(...cur)} ${out(...p2)} `;
    }
    return `${d}Z`;
  }

  root.LotGeo = { resample, stripLots, polyInfo, roundedPath };
})(typeof window !== 'undefined' ? window : globalThis);
