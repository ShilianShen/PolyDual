export const numericValues = (value: string): number[] => (value.match(/-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/g) ?? []).map(Number);
export const attributes = (markup: string): Record<string, string> => Object.fromEntries(
  [...(markup.match(/^<[^>]+>/)?.[0] ?? markup).matchAll(/([\w-]+)="([^"]*)"/g)].map(m => [m[1], m[2]]),
);

/** Read both animated attributes and static replacements after optimization. */
export function valueAt(markup: string, attribute: string, t: number): string {
  const animation = [...markup.matchAll(/<animate\b[^>]*\/>/g)].map(m => attributes(m[0])).find(a => a.attributeName === attribute);
  if (!animation) {
    const value = attributes(markup)[attribute];
    if (value === undefined) throw new Error(`Missing SVG attribute ${attribute}`);
    return value;
  }
  const times = animation.keyTimes.split(";").map(Number), values = animation.values.split(";");
  const i = times.findLastIndex(time => time <= t);
  if (i < 0) throw new Error("SVG time precedes the animation");
  if (animation.calcMode === "discrete" || i === times.length - 1) return values[i];
  const u = (t - times[i]) / (times[i + 1] - times[i]);
  const a = numericValues(values[i]), b = numericValues(values[i + 1]);
  let n = 0;
  return values[i].replace(/-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/g, () => {
    const result = a[n] + (b[n] - a[n]) * u;
    n++;
    return result.toString();
  });
}

export function facesIn(group: string): Map<number, string> {
  return new Map([...group.matchAll(/<path\b[^>]*class="polydual-(?:primary|dual)"[^>]*>.*?<\/path>/gs)].map(m => [
    Number(attributes(m[0]).id.match(/-face-(\d+)$/)![1]), m[0],
  ]));
}

export function edgesIn(group: string): Map<number, string> {
  return new Map([...group.matchAll(/<path class="polydual-hidden-edge"[^>]*>.*?<\/path>/gs)].map(m => [
    Number(attributes(m[0]).id.match(/-edge-(\d+)$/)![1]), m[0],
  ]));
}
