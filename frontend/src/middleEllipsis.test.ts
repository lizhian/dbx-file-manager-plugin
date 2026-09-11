import { describe, expect, it } from 'vitest';
import { middleEllipsis } from './middleEllipsis';

const measure = (text: string) => Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)).length;
describe('middle filename ellipsis', () => {
  it('shows the full name when it fits and keeps both ends when narrowed', () => {
    expect(middleEllipsis('report.txt', 10, measure)).toBe('report.txt');
    expect(middleEllipsis('report.txt', 8, measure)).toBe('r....txt');
    expect(middleEllipsis('abcdefghijklmnop', 11, measure)).toBe('abcd...mnop');
  });
  it('keeps Unicode graphemes and handles folders, dotfiles and tiny widths', () => {
    expect(middleEllipsis('中文文件夹名称', 6, measure)).toBe('中文...称');
    expect(middleEllipsis('👨‍👩‍👧‍👦abcdef🇨🇳', 5, measure)).toBe('👨‍👩‍👧‍👦...🇨🇳');
    expect(middleEllipsis('.abcdefgh', 7, measure)).toBe('.a...gh');
    expect(middleEllipsis('long-name', 2, measure)).toBe('');
  });
});
