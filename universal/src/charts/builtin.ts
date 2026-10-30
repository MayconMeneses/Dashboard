import { drawBubble } from './bubble.js';
import { drawFunnel } from './funnel.js';
import { drawHeatmap } from './heatmap.js';
import { drawMap } from './map.js';
import { createRegistry } from './registry.js';
import { drawScatter } from './scatter.js';
import { drawSmall } from './small.js';

/** Desenhos que acompanham o painel. O restante (barras, linhas, rosca, radar…) usa o caminho padrão com Chart.js. */
export const registry = createRegistry()
  .kind('map', (c) => drawMap(c.card, c.t, { forced: c.forced, basemap: c.basemap, onBasemap: c.onBasemap }, c.host))
  .kind('scatter', (c) => (c.spec.x && c.spec.y ? drawScatter(c.card, c.spec, c.t, c.host) : null))
  .kind('funnel', (c) => drawFunnel(c.card, c.spec, c.t, c.host))
  .kind('bubble', (c) => drawBubble(c.card, c.spec, c.t, c.host))
  .shape('heatmap', (c) => (c.d ? drawHeatmap(c.card, c.spec, c.d, c.host) : null))
  .shape('small', (c) => (c.d ? drawSmall(c.card, c.d, c.host) : null));
