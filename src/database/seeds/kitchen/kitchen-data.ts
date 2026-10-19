/**
 * Demo kitchen data for seed:kitchen — fictional, for the demo vendors
 * seed:food creates. Prices are rough 2026 Lahore market rupees, for
 * demonstration only.
 */
export interface DemoIngredient {
  key: string;
  name: string;
  nameUr: string;
  category:
    | 'meat'
    | 'vegetable'
    | 'dairy'
    | 'spice'
    | 'grain'
    | 'oil'
    | 'bakery'
    | 'beverage'
    | 'packaging'
    | 'other';
  baseUnit: 'g' | 'ml' | 'piece';
  /** Purchase unit and rupees per that unit (8 weeks ago); `drift` = % change by today. */
  buy: { unit: 'kg' | 'l' | 'piece' | 'tray'; price: number; drift: number };
  customUnits?: Array<{ name: string; factor: number }>;
  /** Par level in the purchase unit. */
  par?: number;
  /** Shelf life in days (expiry on purchases). */
  life?: number;
}

export const KITCHEN_INGREDIENTS: DemoIngredient[] = [
  {
    key: 'rice',
    name: 'Basmati Rice',
    nameUr: 'باسمتی چاول',
    category: 'grain',
    baseUnit: 'g',
    buy: { unit: 'kg', price: 330, drift: 4 },
    par: 10,
  },
  {
    key: 'chicken',
    name: 'Chicken',
    nameUr: 'مرغی',
    category: 'meat',
    baseUnit: 'g',
    buy: { unit: 'kg', price: 620, drift: 9 },
    par: 8,
    life: 3,
  },
  {
    key: 'mutton',
    name: 'Mutton',
    nameUr: 'بکرے کا گوشت',
    category: 'meat',
    baseUnit: 'g',
    buy: { unit: 'kg', price: 2300, drift: 5 },
    par: 3,
    life: 3,
  },
  {
    key: 'beef',
    name: 'Beef',
    nameUr: 'بڑا گوشت',
    category: 'meat',
    baseUnit: 'g',
    buy: { unit: 'kg', price: 1250, drift: 6 },
    par: 4,
    life: 3,
  },
  {
    key: 'onion',
    name: 'Onion',
    nameUr: 'پیاز',
    category: 'vegetable',
    baseUnit: 'g',
    buy: { unit: 'kg', price: 150, drift: 12 },
    par: 8,
    life: 21,
  },
  {
    key: 'tomato',
    name: 'Tomato',
    nameUr: 'ٹماٹر',
    category: 'vegetable',
    baseUnit: 'g',
    buy: { unit: 'kg', price: 170, drift: 45 },
    par: 6,
    life: 6,
  },
  {
    key: 'potato',
    name: 'Potato',
    nameUr: 'آلو',
    category: 'vegetable',
    baseUnit: 'g',
    buy: { unit: 'kg', price: 110, drift: 0 },
    par: 5,
    life: 30,
  },
  {
    key: 'mint',
    name: 'Mint',
    nameUr: 'پودینہ',
    category: 'vegetable',
    baseUnit: 'g',
    buy: { unit: 'kg', price: 300, drift: 0 },
    life: 3,
  },
  {
    key: 'yogurt',
    name: 'Yogurt',
    nameUr: 'دہی',
    category: 'dairy',
    baseUnit: 'g',
    buy: { unit: 'kg', price: 230, drift: 4 },
    par: 5,
    life: 4,
  },
  {
    key: 'milk',
    name: 'Milk',
    nameUr: 'دودھ',
    category: 'dairy',
    baseUnit: 'ml',
    buy: { unit: 'l', price: 210, drift: 5 },
    par: 6,
    life: 2,
  },
  {
    key: 'eggs',
    name: 'Eggs',
    nameUr: 'انڈے',
    category: 'dairy',
    baseUnit: 'piece',
    buy: { unit: 'tray', price: 840, drift: 6 },
    customUnits: [{ name: 'tray', factor: 30 }],
    life: 14,
  },
  {
    key: 'oil',
    name: 'Cooking Oil',
    nameUr: 'تیل',
    category: 'oil',
    baseUnit: 'ml',
    buy: { unit: 'l', price: 510, drift: 2 },
    par: 10,
  },
  {
    key: 'ghee',
    name: 'Ghee',
    nameUr: 'گھی',
    category: 'oil',
    baseUnit: 'ml',
    buy: { unit: 'l', price: 650, drift: 3 },
    par: 5,
  },
  {
    key: 'flour',
    name: 'Flour',
    nameUr: 'آٹا',
    category: 'grain',
    baseUnit: 'g',
    buy: { unit: 'kg', price: 135, drift: 2 },
    par: 15,
  },
  {
    key: 'lentils',
    name: 'Lentils',
    nameUr: 'دال',
    category: 'grain',
    baseUnit: 'g',
    buy: { unit: 'kg', price: 360, drift: 1 },
  },
  {
    key: 'sugar',
    name: 'Sugar',
    nameUr: 'چینی',
    category: 'other',
    baseUnit: 'g',
    buy: { unit: 'kg', price: 155, drift: 3 },
  },
  {
    key: 'tea',
    name: 'Tea Leaves',
    nameUr: 'چائے کی پتی',
    category: 'beverage',
    baseUnit: 'g',
    buy: { unit: 'kg', price: 1600, drift: 0 },
  },
  {
    key: 'biryani_masala',
    name: 'Biryani Masala',
    nameUr: 'بریانی مصالحہ',
    category: 'spice',
    baseUnit: 'g',
    buy: { unit: 'kg', price: 1500, drift: 0 },
  },
  {
    key: 'garam_masala',
    name: 'Garam Masala',
    nameUr: 'گرم مصالحہ',
    category: 'spice',
    baseUnit: 'g',
    buy: { unit: 'kg', price: 2000, drift: 0 },
  },
  {
    key: 'charcoal',
    name: 'Charcoal',
    nameUr: 'کوئلہ',
    category: 'other',
    baseUnit: 'g',
    buy: { unit: 'kg', price: 120, drift: 0 },
  },
  {
    key: 'box',
    name: 'Takeaway Box',
    nameUr: 'ڈبہ',
    category: 'packaging',
    baseUnit: 'piece',
    buy: { unit: 'piece', price: 15, drift: 0 },
    par: 100,
  },
];

type Line = [
  ingredient: string,
  qty: number,
  unit: 'g' | 'ml' | 'piece',
  packaging?: boolean,
];

/** Per-serving recipe by keyword in the dish name (first match wins). */
export const RECIPE_TEMPLATES: Array<{
  match: RegExp;
  lines: (name: string) => Line[];
}> = [
  {
    match: /biryani/i,
    lines: (n) => [
      ['rice', 150, 'g'],
      [
        /beef/i.test(n) ? 'beef' : /mutton/i.test(n) ? 'mutton' : 'chicken',
        150,
        'g',
      ],
      ['onion', 60, 'g'],
      ['tomato', 50, 'g'],
      ['yogurt', 40, 'g'],
      ['oil', 25, 'ml'],
      ['biryani_masala', 8, 'g'],
      ['box', 1, 'piece', true],
    ],
  },
  {
    match: /pulao/i,
    lines: () => [
      ['rice', 150, 'g'],
      ['chicken', 130, 'g'],
      ['onion', 50, 'g'],
      ['oil', 20, 'ml'],
      ['garam_masala', 4, 'g'],
      ['box', 1, 'piece', true],
    ],
  },
  {
    match: /karahi/i,
    lines: (n) => [
      [/mutton/i.test(n) ? 'mutton' : 'chicken', 250, 'g'],
      /white/i.test(n) ? ['yogurt', 100, 'g'] : ['tomato', 120, 'g'],
      ['ghee', 40, 'ml'],
      ['garam_masala', 5, 'g'],
      ['box', 1, 'piece', true],
    ],
  },
  {
    match: /handi|qorma/i,
    lines: () => [
      ['chicken', 200, 'g'],
      ['yogurt', 70, 'g'],
      ['onion', 60, 'g'],
      ['ghee', 30, 'ml'],
      ['garam_masala', 5, 'g'],
      ['box', 1, 'piece', true],
    ],
  },
  {
    match: /nihari/i,
    lines: () => [
      ['beef', 220, 'g'],
      ['flour', 15, 'g'],
      ['ghee', 35, 'ml'],
      ['garam_masala', 6, 'g'],
      ['box', 1, 'piece', true],
    ],
  },
  {
    match: /haleem/i,
    lines: () => [
      ['beef', 120, 'g'],
      ['lentils', 80, 'g'],
      ['ghee', 25, 'ml'],
      ['garam_masala', 4, 'g'],
      ['box', 1, 'piece', true],
    ],
  },
  {
    match: /aloo gosht/i,
    lines: () => [
      ['mutton', 150, 'g'],
      ['potato', 150, 'g'],
      ['tomato', 60, 'g'],
      ['oil', 25, 'ml'],
      ['box', 1, 'piece', true],
    ],
  },
  {
    match: /daal|dal/i,
    lines: () => [
      ['lentils', 120, 'g'],
      ['ghee', 20, 'ml'],
      ['onion', 30, 'g'],
      ['box', 1, 'piece', true],
    ],
  },
  {
    match: /shami/i,
    lines: () => [
      ['beef', 300, 'g'],
      ['lentils', 150, 'g'],
      ['eggs', 2, 'piece'],
      ['oil', 100, 'ml'],
    ],
  },
  {
    match: /seekh/i,
    lines: () => [
      ['beef', 200, 'g'],
      ['onion', 30, 'g'],
      ['charcoal', 150, 'g'],
      ['box', 1, 'piece', true],
    ],
  },
  {
    match: /tikka|boti|bbq|platter/i,
    lines: (n) => [
      ['chicken', /platter/i.test(n) ? 900 : 220, 'g'],
      ['yogurt', 40, 'g'],
      ['oil', 10, 'ml'],
      ['charcoal', /platter/i.test(n) ? 500 : 150, 'g'],
      ['box', 1, 'piece', true],
    ],
  },
  {
    match: /naan|roti/i,
    lines: (n) => [
      ['flour', 120, 'g'],
      ...(/roghni|garlic/i.test(n) ? ([['ghee', 10, 'ml']] as Line[]) : []),
    ],
  },
  {
    match: /raita/i,
    lines: () => [
      ['yogurt', 150, 'g'],
      ['mint', 5, 'g'],
    ],
  },
  {
    match: /salad/i,
    lines: () => [
      ['tomato', 80, 'g'],
      ['onion', 60, 'g'],
    ],
  },
  {
    match: /zarda/i,
    lines: () => [
      ['rice', 80, 'g'],
      ['sugar', 50, 'g'],
      ['ghee', 15, 'ml'],
      ['box', 1, 'piece', true],
    ],
  },
  {
    match: /kheer/i,
    lines: () => [
      ['milk', 200, 'ml'],
      ['rice', 30, 'g'],
      ['sugar', 40, 'g'],
    ],
  },
  {
    match: /gulab jamun/i,
    lines: (n) => {
      const k = /dozen/i.test(n) ? 12 : 2;
      return [
        ['flour', 15 * k, 'g'],
        ['milk', 25 * k, 'ml'],
        ['sugar', 25 * k, 'g'],
        ['oil', 10 * k, 'ml'],
      ];
    },
  },
  {
    match: /chai|tea/i,
    lines: () => [
      ['tea', 5, 'g'],
      ['milk', 150, 'ml'],
      ['sugar', 15, 'g'],
    ],
  },
  {
    match: /lassi/i,
    lines: () => [
      ['yogurt', 200, 'g'],
      ['sugar', 15, 'g'],
    ],
  },
  {
    match: /margarita|mint/i,
    lines: () => [
      ['mint', 10, 'g'],
      ['sugar', 20, 'g'],
    ],
  },
];

/** The demo vendors (seed:food keys) that get a full kitchen. */
export const KITCHEN_VENDORS: Array<{
  key: string;
  ordersPerDay: number;
  prepMinutes: number;
}> = [
  { key: 'zafran', ordersPerDay: 11, prepMinutes: 22 },
  { key: 'qandeel', ordersPerDay: 9, prepMinutes: 30 },
  { key: 'rukhsana', ordersPerDay: 4, prepMinutes: 35 },
];

export const DEMO_SUPPLIERS = [
  {
    name: 'Akbari Mandi — Ashraf Traders',
    phone: '03001112233',
    notes: 'Vegetables, early morning',
  },
  {
    name: 'Al-Madina Meat Shop',
    phone: '03214445566',
    notes: 'Chicken and mutton, cuts to order',
  },
  {
    name: 'Metro Cash & Carry (bulk)',
    phone: null,
    notes: 'Rice, oil, ghee, spices, boxes',
  },
];

/** SPI items (as PBS names them) for the price-watch sample: [item, unit, Lahore price 8 weeks ago, weekly drift %]. */
export const SPI_SAMPLE: Array<[string, string, number, number]> = [
  ['Tomatoes', 'kg', 160, 4.5],
  ['Onions', 'kg', 140, 1.2],
  ['Potatoes', 'kg', 105, 0],
  ['Chicken Broiler', 'kg', 600, 1],
  ['Mutton', 'kg', 2250, 0.5],
  ['Beef', 'kg', 1200, 0.6],
  ['Milk Fresh', 'litre', 200, 0.5],
  ['Curd (Yogurt)', 'kg', 220, 0.4],
  ['Rice Basmati', 'kg', 320, 0.5],
  ['Wheat Flour', 'kg', 130, 0.2],
  ['Sugar', 'kg', 150, 0.3],
  ['Cooking Oil', 'litre', 500, 0.2],
  ['Eggs Farm', 'dozen', 330, 0.6],
];
/** Karachi relative to Lahore. */
export const SPI_CITY_FACTOR: Record<string, number> = {
  Lahore: 1,
  Karachi: 1.06,
};
