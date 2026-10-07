import { describe, expect, it } from 'vitest';
import { defaultBasemap, getBasemaps } from './basemaps';

describe('mapas-base', () => {
  it('só oferece CARTO quando há chave, e a chave vai na URL', () => {
    expect(getBasemaps().some((b) => b.id === 'voyager')).toBe(false);
    const v = getBasemaps('abc 123').find((b) => b.id === 'voyager')!;
    expect(v.url).toBe('https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png?key=abc%20123');
    expect(v.attribution).toContain('CARTO');
  });
  it('escolhe o Voyager por padrão com chave', () => {
    expect(defaultBasemap('k')).toBe('voyager');
  });
});
