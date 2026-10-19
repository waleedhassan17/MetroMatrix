import { classifyMenu, experimentVerdict, median } from './menu-engineering';

describe('menu engineering', () => {
  it('median of odd and even lists', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  it('quadrants match the hand calculation (QA #27 seed)', () => {
    // Costed: qty 120, 90, 40, 20 → median 65; margin 300, 150, 420, 100 → median 225.
    const r = classifyMenu([
      { itemId: 'a', name: 'Chicken Karahi', qty: 120, margin: 300 },
      { itemId: 'b', name: 'Daal Chawal', qty: 90, margin: 150 },
      { itemId: 'c', name: 'Mutton Pulao', qty: 40, margin: 420 },
      { itemId: 'd', name: 'Veg Roll', qty: 20, margin: 100 },
      { itemId: 'e', name: 'Kheer', qty: 70, margin: null },
    ]);
    expect(r.medianQty).toBe(65);
    expect(r.medianMargin).toBe(225);
    expect(
      Object.fromEntries(r.items.map((i) => [i.name, [i.quadrant, i.action]])),
    ).toEqual({
      'Chicken Karahi': ['star', 'feature'],
      'Daal Chawal': ['plowhorse', 'reprice'],
      'Mutton Pulao': ['puzzle', 'redescribe_or_bundle'],
      'Veg Roll': ['dog', 'remove'],
    });
    expect(r.needsRecipe).toEqual([{ itemId: 'e', name: 'Kheer', qty: 70 }]);
  });

  it('on the median counts as popular / profitable', () => {
    const r = classifyMenu([
      { itemId: 'a', name: 'A', qty: 10, margin: 100 },
      { itemId: 'b', name: 'B', qty: 10, margin: 100 },
    ]);
    expect(r.items.map((i) => i.quadrant)).toEqual(['star', 'star']);
    expect(classifyMenu([]).items).toEqual([]);
  });
});

describe('menu experiments', () => {
  const base = {
    days: 14,
    vsForecast: null,
    foodCostPct: 30,
    targetFoodCostPct: 35,
  };
  it('keep: at or above the category median, cost on target', () => {
    expect(
      experimentVerdict({ ...base, itemDaily: 12, categoryMedianDaily: 10 }),
    ).toMatchObject({ salesIndex: 1.2, recommendation: 'keep' });
  });

  it('adjust: sells fine but food cost is above target; or a little below the median', () => {
    const cost = experimentVerdict({
      ...base,
      itemDaily: 12,
      categoryMedianDaily: 10,
      foodCostPct: 41,
    });
    expect(cost.recommendation).toBe('adjust');
    expect(cost.reasons.join(' ')).toMatch(/41% is above your 35% target/);
    expect(
      experimentVerdict({ ...base, itemDaily: 7, categoryMedianDaily: 10 })
        .recommendation,
    ).toBe('adjust');
  });

  it('drop: under half the median, unless it beats its forecast', () => {
    expect(
      experimentVerdict({ ...base, itemDaily: 4, categoryMedianDaily: 10 }),
    ).toMatchObject({ salesIndex: 0.4, recommendation: 'drop' });
    expect(
      experimentVerdict({
        ...base,
        itemDaily: 4,
        categoryMedianDaily: 10,
        vsForecast: 1.1,
      }).recommendation,
    ).toBe('adjust');
  });

  it('too early: no verdict before 3 days', () => {
    expect(
      experimentVerdict({
        ...base,
        days: 2,
        itemDaily: 1,
        categoryMedianDaily: 10,
      }),
    ).toMatchObject({ recommendation: null });
  });
});
