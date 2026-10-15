import { readFileSync } from 'fs';
import { join } from 'path';
import { MEDICINES } from '../../../database/migrations/1792099700000-HealthReferenceSeed';
import { MEDICINE_FORMS } from './entities/medicine.entity';

describe('medicine reference list', () => {
  it('the migration ships exactly seed/health/medicines.csv', () => {
    const csv = readFileSync(
      join(__dirname, '../../../../seed/health/medicines.csv'),
      'utf8',
    )
      .trim()
      .split('\n')
      .slice(1)
      .map((line) => {
        const cells: string[] = [];
        let cur = '';
        let quoted = false;
        for (const ch of line.replace(/\r$/, '')) {
          if (ch === '"') quoted = !quoted;
          else if (ch === ',' && !quoted) {
            cells.push(cur);
            cur = '';
          } else cur += ch;
        }
        cells.push(cur);
        return cells;
      });
    expect(MEDICINES).toEqual(csv);
    expect(MEDICINES.length).toBeGreaterThanOrEqual(300);
    MEDICINES.forEach(([, , form]) => expect(MEDICINE_FORMS).toContain(form));
  });
});
