import { parseCsv, readSpi, spiUnit } from './spi-csv';

describe('SPI CSV import', () => {
  it('parses quotes, escaped quotes and CRLF', () => {
    expect(parseCsv('a,"b, c","d ""e"""\r\n1,2,3\r\n')).toEqual([
      ['a', 'b, c', 'd "e"'],
      ['1', '2', '3'],
    ]);
  });

  it('reads the template for two cities and reports bad rows by line', () => {
    const csv = [
      'week_ending,city,item,unit,price',
      '2026-10-15,Lahore,Tomatoes,kg,180',
      '2026-10-15,Karachi,Tomatoes,kg,"1,95"',
      '2026-10-15,Lahore,"Eggs Hen (Farm)",dozen,Rs 360',
      '2026-10-15,Lahore,Milk Fresh,litre,220',
      '15/10/2026,Lahore,Onions,kg,120',
      '2026-10-15,Lahore,Cooking Oil,tin,2600',
      '2026-10-15,Lahore,Sugar,kg,0',
    ].join('\n');
    const { rows, errors } = readSpi(csv);
    expect(rows.map((r) => [r.city, r.item, r.price])).toEqual([
      ['Lahore', 'Tomatoes', 180],
      ['Karachi', 'Tomatoes', 195],
      ['Lahore', 'Eggs Hen (Farm)', 360],
      ['Lahore', 'Milk Fresh', 220],
    ]);
    expect(errors.map((e) => e.line)).toEqual([6, 7, 8]);
  });

  it('refuses a file without the header', () => {
    expect(readSpi('date,city\n2026-10-15,Lahore').errors[0].error).toMatch(
      /header/,
    );
  });

  it('reads PBS units', () => {
    expect(spiUnit('kg')).toEqual({ baseUnit: 'g', factor: 1000 });
    expect(spiUnit('2.5 Kg')).toEqual({ baseUnit: 'g', factor: 2500 });
    expect(spiUnit('250 grams')).toEqual({ baseUnit: 'g', factor: 250 });
    expect(spiUnit('Litre')).toEqual({ baseUnit: 'ml', factor: 1000 });
    expect(spiUnit('dozen')).toEqual({ baseUnit: 'piece', factor: 12 });
    expect(spiUnit('each')).toEqual({ baseUnit: 'piece', factor: 1 });
    expect(spiUnit('tin')).toBeNull();
  });
});
