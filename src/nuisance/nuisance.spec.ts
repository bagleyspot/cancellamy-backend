import { normaliseNumber } from './nuisance.service';

describe('normaliseNumber', () => {
  it('treats the usual spellings of an Italian number as the same caller', () => {
    const variants = ['+39 02 1234567', '0039 02 1234567', '02 1234567', '(02) 123-4567', '3902 1234567'];
    expect(new Set(variants.map(normaliseNumber)).size).toBe(1);
    expect(normaliseNumber('+39 333 1234567')).toBe('3331234567');
    expect(normaliseNumber(null)).toBe('');
    expect(normaliseNumber('anonimo')).toBe('');
  });
});
