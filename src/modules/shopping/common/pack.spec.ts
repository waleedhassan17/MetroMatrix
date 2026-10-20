import { effectivePack, packIn, pricePerUnit } from './pack';

describe('pack size and price per unit', () => {
  it('normalises to kg, l and pieces', () => {
    expect(packIn({ qty: 500, unit: 'g' })).toEqual({ qty: 0.5, per: 'kg' });
    expect(packIn({ qty: 1.5, unit: 'l' })).toEqual({ qty: 1.5, per: 'l' });
    expect(packIn({ qty: 2, unit: 'dozen' })).toEqual({
      qty: 24,
      per: 'piece',
    });
  });

  it('price per unit; a 5 kg bag can be cheaper than a 1 kg one', () => {
    expect(pricePerUnit(480, { qty: 500, unit: 'g' })).toEqual({
      price: 960,
      per: 'kg',
    });
    expect(pricePerUnit(1450, { qty: 5, unit: 'kg' })).toEqual({
      price: 290,
      per: 'kg',
    });
    expect(pricePerUnit(360, { qty: 1, unit: 'dozen' })).toEqual({
      price: 30,
      per: 'piece',
    });
    expect(pricePerUnit(100, null)).toBeNull();
  });

  it('a variant pack overrides the product pack', () => {
    const product = { packQty: 1, packUnit: 'kg' };
    expect(effectivePack(product, { packQty: 5, packUnit: 'kg' })).toEqual({
      qty: 5,
      unit: 'kg',
    });
    expect(effectivePack(product, { packQty: null, packUnit: null })).toEqual({
      qty: 1,
      unit: 'kg',
    });
    expect(effectivePack({ packQty: null, packUnit: null })).toBeNull();
  });
});
