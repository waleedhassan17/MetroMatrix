/**
 * Pakistani home recipes for "what can I cook?" without AI (Chunk 5, P11):
 * each lists the canonical ingredients it needs (ingredient_aliases names).
 * Staples (salt, oil, the everyday spices, water) are assumed to be at home
 * and never count as missing. Pure, spec-tested ranking.
 */
export interface LibraryRecipe {
  key: string;
  title: string;
  titleUr: string;
  needs: string[];
  minutes: number;
  servings: number;
  steps: string[];
}

export const STAPLES = new Set([
  'salt',
  'oil',
  'water',
  'red chilli powder',
  'turmeric',
  'cumin',
  'black pepper',
  'garam masala',
  'coriander',
  'green chilli',
  'sugar',
]);

export const RECIPE_LIBRARY: LibraryRecipe[] = [
  {
    key: 'aloo-anday',
    title: 'Aloo anday',
    titleUr: 'آلو انڈے',
    needs: ['potato', 'egg', 'onion', 'tomato'],
    minutes: 30,
    servings: 3,
    steps: [
      'Fry sliced onion until golden.',
      'Add tomato and spices; cook to a masala.',
      'Add cubed potato and a cup of water; cover until soft.',
      'Add boiled, halved eggs and simmer 5 minutes.',
    ],
  },
  {
    key: 'chicken-karahi',
    title: 'Chicken karahi',
    titleUr: 'چکن کڑاہی',
    needs: ['chicken', 'tomato', 'ginger', 'garlic'],
    minutes: 40,
    servings: 4,
    steps: [
      'Fry chicken with garlic and ginger on high heat.',
      'Add chopped tomato and spices; cover and cook down.',
      'Cook uncovered until the oil separates.',
      'Finish with green chilli and ginger strips.',
    ],
  },
  {
    key: 'daal-chawal',
    title: 'Daal chawal',
    titleUr: 'دال چاول',
    needs: ['red lentils', 'rice', 'onion', 'garlic'],
    minutes: 35,
    servings: 4,
    steps: [
      'Boil washed lentils with turmeric until soft.',
      'Cook the rice separately.',
      'Fry garlic and onion for the tarka and pour over the daal.',
    ],
  },
  {
    key: 'aloo-gobi',
    title: 'Aloo gobi',
    titleUr: 'آلو گوبھی',
    needs: ['potato', 'cauliflower', 'onion', 'tomato'],
    minutes: 30,
    servings: 3,
    steps: [
      'Fry onion, add tomato and spices.',
      'Add potato and cauliflower florets.',
      'Cover on low heat until tender, stirring now and then.',
    ],
  },
  {
    key: 'palak-paneer',
    title: 'Palak paneer',
    titleUr: 'پالک پنیر',
    needs: ['spinach', 'paneer', 'onion', 'garlic', 'cream'],
    minutes: 35,
    servings: 3,
    steps: [
      'Blanch and blend the spinach.',
      'Fry garlic and onion; add the spinach and spices.',
      'Add paneer cubes and a splash of cream; simmer 5 minutes.',
    ],
  },
  {
    key: 'bhindi-masala',
    title: 'Bhindi masala',
    titleUr: 'بھنڈی مصالحہ',
    needs: ['okra', 'onion', 'tomato'],
    minutes: 30,
    servings: 3,
    steps: [
      'Fry sliced okra until no longer sticky; set aside.',
      'Make a masala with onion, tomato and spices.',
      'Add the okra back and cook 5 minutes.',
    ],
  },
  {
    key: 'chana-masala',
    title: 'Chana masala',
    titleUr: 'چنا مصالحہ',
    needs: ['chickpeas', 'onion', 'tomato', 'ginger', 'garlic'],
    minutes: 40,
    servings: 4,
    steps: [
      'Soak and boil the chickpeas (or use boiled).',
      'Fry onion, ginger and garlic; add tomato and spices.',
      'Add chickpeas with some water and simmer until thick.',
    ],
  },
  {
    key: 'qeema-matar',
    title: 'Qeema matar',
    titleUr: 'قیمہ مٹر',
    needs: ['mince', 'peas', 'onion', 'tomato', 'ginger', 'garlic'],
    minutes: 40,
    servings: 4,
    steps: [
      'Brown the mince with onion, ginger and garlic.',
      'Add tomato and spices; cook until dry.',
      'Add peas and a little water; cook until soft.',
    ],
  },
  {
    key: 'anda-paratha',
    title: 'Anda paratha',
    titleUr: 'انڈا پراٹھا',
    needs: ['egg', 'flour', 'onion'],
    minutes: 20,
    servings: 2,
    steps: [
      'Knead a soft dough and roll a paratha.',
      'Beat eggs with onion and green chilli.',
      'Cook the paratha, pour the egg on and fold.',
    ],
  },
  {
    key: 'vegetable-pulao',
    title: 'Vegetable pulao',
    titleUr: 'سبزی پلاؤ',
    needs: ['rice', 'carrot', 'peas', 'potato', 'onion'],
    minutes: 40,
    servings: 4,
    steps: [
      'Fry onion with whole spices.',
      'Add vegetables, then soaked rice and water.',
      'Cook covered on low heat until the water is absorbed.',
    ],
  },
  {
    key: 'chicken-pulao',
    title: 'Chicken pulao',
    titleUr: 'چکن پلاؤ',
    needs: ['chicken', 'rice', 'onion', 'yogurt', 'garlic', 'ginger'],
    minutes: 60,
    servings: 5,
    steps: [
      'Make a stock with the chicken, garlic and ginger.',
      'Fry onion; add chicken and yogurt.',
      'Add rice and the stock; steam (dum) until done.',
    ],
  },
  {
    key: 'raita',
    title: 'Raita',
    titleUr: 'رائتہ',
    needs: ['yogurt', 'cucumber', 'mint'],
    minutes: 10,
    servings: 4,
    steps: [
      'Whisk the yogurt.',
      'Add grated cucumber and chopped mint.',
      'Season with salt and roasted cumin.',
    ],
  },
  {
    key: 'kheer',
    title: 'Kheer',
    titleUr: 'کھیر',
    needs: ['milk', 'rice', 'cardamom', 'almonds'],
    minutes: 60,
    servings: 5,
    steps: [
      'Simmer washed rice in milk, stirring often.',
      'Add sugar and crushed cardamom when thick.',
      'Garnish with sliced almonds; chill.',
    ],
  },
  {
    key: 'shami-kabab',
    title: 'Shami kabab',
    titleUr: 'شامی کباب',
    needs: ['beef', 'split chickpeas', 'onion', 'egg'],
    minutes: 75,
    servings: 6,
    steps: [
      'Boil beef with split chickpeas and whole spices until dry.',
      'Grind to a paste; mix with onion and herbs.',
      'Shape, dip in beaten egg and shallow-fry.',
    ],
  },
  {
    key: 'mixed-sabzi',
    title: 'Mixed sabzi',
    titleUr: 'مکس سبزی',
    needs: ['potato', 'carrot', 'peas', 'capsicum', 'tomato'],
    minutes: 30,
    servings: 4,
    steps: [
      'Make a light masala with tomato and spices.',
      'Add the vegetables, hardest first.',
      'Cover and cook until tender.',
    ],
  },
  {
    key: 'egg-fried-rice',
    title: 'Egg fried rice',
    titleUr: 'انڈا فرائیڈ رائس',
    needs: ['rice', 'egg', 'capsicum', 'carrot', 'soy sauce'],
    minutes: 20,
    servings: 3,
    steps: [
      'Use rice cooked earlier (cold is best).',
      'Scramble the eggs; set aside.',
      'Stir-fry vegetables, add rice, soy sauce and the egg.',
    ],
  },
  {
    key: 'tomato-chutney',
    title: 'Tomato chutney',
    titleUr: 'ٹماٹر کی چٹنی',
    needs: ['tomato', 'garlic', 'tamarind'],
    minutes: 20,
    servings: 6,
    steps: [
      'Cook chopped tomato with garlic until soft.',
      'Add tamarind, sugar and red chilli.',
      'Cook down to a thick chutney.',
    ],
  },
  {
    key: 'pakoray',
    title: 'Pakoray',
    titleUr: 'پکوڑے',
    needs: ['gram flour', 'potato', 'onion', 'spinach'],
    minutes: 25,
    servings: 4,
    steps: [
      'Make a thick batter of gram flour, water and spices.',
      'Mix in sliced onion, potato and spinach.',
      'Deep-fry spoonfuls until golden.',
    ],
  },
  {
    key: 'fruit-chaat',
    title: 'Fruit chaat',
    titleUr: 'فروٹ چاٹ',
    needs: ['apple', 'banana', 'mango', 'pomegranate'],
    minutes: 15,
    servings: 4,
    steps: [
      'Cut the fruit into cubes.',
      'Sprinkle chaat masala and a little sugar.',
      'Squeeze lemon over and toss.',
    ],
  },
  {
    key: 'lauki-chana-daal',
    title: 'Lauki chana daal',
    titleUr: 'لوکی چنے کی دال',
    needs: ['bottle gourd', 'split chickpeas', 'onion', 'tomato'],
    minutes: 45,
    servings: 4,
    steps: [
      'Boil the split chickpeas until half done.',
      'Add bottle gourd cubes and the masala.',
      'Simmer until both are soft.',
    ],
  },
];

export interface PantryInput {
  id: string;
  name: string;
  canonical: string | null;
  /** Days until it expires (0 = today); null when no date. */
  daysLeft: number | null;
}

/** Expiring within this many days counts as "use it first". */
export const EXPIRING_DAYS = 3;

const isExpiring = (p: PantryInput) =>
  p.daysLeft !== null && p.daysLeft <= EXPIRING_DAYS;

/**
 * Score = 3 × expiring items used + 1 × items used − 1.5 × missing
 * (staples never missing). At least one pantry item must be used.
 */
export function rankLibrary(pantry: PantryInput[], limit = 5) {
  const byCanonical = new Map<string, PantryInput[]>();
  for (const p of pantry)
    if (p.canonical)
      byCanonical.set(p.canonical, [
        ...(byCanonical.get(p.canonical) ?? []),
        p,
      ]);
  return RECIPE_LIBRARY.map((r) => {
    const uses = r.needs.flatMap((n) => {
      const items = byCanonical.get(n) ?? [];
      // The soonest-expiring one of that ingredient.
      const best = [...items].sort(
        (a, b) => (a.daysLeft ?? 999) - (b.daysLeft ?? 999),
      )[0];
      return best ? [best] : [];
    });
    const missing = r.needs.filter(
      (n) => !byCanonical.has(n) && !STAPLES.has(n),
    );
    const expiring = uses.filter(isExpiring).length;
    return {
      recipe: r,
      uses,
      missing,
      expiring,
      score: 3 * expiring + uses.length - 1.5 * missing.length,
    };
  })
    .filter((x) => x.uses.length > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.missing.length - b.missing.length ||
        a.recipe.key.localeCompare(b.recipe.key),
    )
    .slice(0, limit);
}
