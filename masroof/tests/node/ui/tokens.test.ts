import { contrastRatio, CONTRAST_PAIRS, palettes, relativeLuminance } from '@/ui/tokens';

describe('design tokens', () => {
  it('computes WCAG contrast correctly', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
    expect(() => relativeLuminance('red')).toThrow();
  });

  for (const scheme of ['light', 'dark'] as const) {
    describe(`${scheme} palette`, () => {
      it.each(CONTRAST_PAIRS.map(([fg, bg]) => [fg, bg]))('%s on %s ≥ 4.5:1', (fg, bg) => {
        const p = palettes[scheme];
        expect(contrastRatio(p[fg], p[bg])).toBeGreaterThanOrEqual(4.5);
      });
    });
  }

  it('defines the same keys in both schemes', () => {
    expect(Object.keys(palettes.dark).sort()).toEqual(Object.keys(palettes.light).sort());
  });
});
