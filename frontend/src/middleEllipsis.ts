const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function middleEllipsis(name: string, width: number, measure: (text: string) => number): string {
  if (measure(name) <= width) return name;
  const parts = Array.from(segmenter.segment(name), part => part.segment);
  const dot = parts.lastIndexOf('.');
  const suffix = dot > 0 ? parts.length - dot : 0;
  const candidate = (count: number) => {
    const tail = Math.min(count - 1, Math.max(Math.floor(count / 2), suffix));
    return parts.slice(0, count - tail).join('') + '...' + parts.slice(-tail).join('');
  };
  let low = 2, high = parts.length - 1, result = measure('...') <= width ? '...' : '';
  while (low <= high) {
    const count = Math.floor((low + high) / 2);
    const text = candidate(count);
    if (measure(text) <= width) { result = text; low = count + 1; }
    else high = count - 1;
  }
  return result;
}
