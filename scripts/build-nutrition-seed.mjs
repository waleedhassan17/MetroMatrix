#!/usr/bin/env node
/**
 * Builds src/database/seeds/nutrition/nutrition-foods.data.ts (Chunk 5, P10)
 * from USDA FoodData Central, SR Legacy (April 2018) — public domain (CC0).
 *
 *   node scripts/build-nutrition-seed.mjs <path to FoodData_Central_sr_legacy_food_csv_2018-04.zip>
 *
 * Download the zip first (about 6 MB):
 *   https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip
 *
 * Every canonical ingredient name the kitchen knows (ingredient_aliases) is
 * mapped to one SR Legacy food — a USDA equivalent where USDA has no exact
 * match, labelled so (paneer → fresh queso fresco, masala mixes → curry
 * powder). Then common foods by category fill the table to about 400.
 * Values are per 100 g: kcal, protein, carbohydrate, fat, fibre (g) and
 * sodium (mg). Pork and alcohol are left out. The output is committed; a
 * migration loads it, so builds never download anything.
 */
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { inflateRawSync } from 'zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const zipPath = process.argv[2];
if (!zipPath) {
  console.error('usage: node scripts/build-nutrition-seed.mjs <sr_legacy zip>');
  process.exit(1);
}

// ── A minimal zip reader (central directory + deflate) ──
const zip = readFileSync(zipPath);
function entries() {
  let eocd = zip.length - 22;
  while (eocd >= 0 && zip.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('not a zip file');
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  const out = new Map();
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory');
    const method = zip.readUInt16LE(p + 10);
    const size = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    const name = zip.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    out.set(name.split('/').pop(), { method, size, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
const files = entries();
function read(name) {
  const e = files.get(name);
  if (!e) throw new Error(`${name} missing from the zip`);
  const n = zip.readUInt16LE(e.local + 26);
  const x = zip.readUInt16LE(e.local + 28);
  const start = e.local + 30 + n + x;
  const raw = zip.subarray(start, start + e.size);
  const data = e.method === 8 ? inflateRawSync(raw) : raw;
  return data.toString('utf8');
}
function* csv(text) {
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      yield row;
      row = [];
    } else field += c;
  }
  if (field || row.length) yield [...row, field];
}
function table(name) {
  const it = csv(read(name));
  const head = it.next().value;
  const rows = [];
  for (const r of it) if (r.length === head.length) rows.push(Object.fromEntries(head.map((h, i) => [h, r[i]])));
  return rows;
}

// ── Load ──
const NUTRIENTS = { 1008: 'kcal', 1003: 'proteinG', 1005: 'carbsG', 1004: 'fatG', 1079: 'fibreG', 1093: 'sodiumMg' };
const foods = new Map(table('food.csv').map((f) => [Number(f.fdc_id), f]));
const values = new Map();
for (const r of table('food_nutrient.csv')) {
  const key = NUTRIENTS[r.nutrient_id];
  if (!key) continue;
  const id = Number(r.fdc_id);
  if (!values.has(id)) values.set(id, {});
  values.get(id)[key] = Number(r.amount);
}
const clean = (d) =>
  d.replace(/ \(Includes foods for USDA's Food Distribution Program\)/g, '').replace(/\s+/g, ' ').trim();
const slug = (s) =>
  s
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);

// ── 1. Every food canonical (ingredient_aliases) → one SR Legacy food ──
// [canonical, fdcId, Urdu name, grams per piece (for ingredients counted in pieces), note]
const CANONICAL = [
  ['tomato', 170457, 'ٹماٹر', 120],
  ['onion', 170000, 'پیاز', 110],
  ['potato', 170026, 'آلو', 170],
  ['garlic', 169230, 'لہسن', 3],
  ['ginger', 169231, 'ادرک'],
  ['green chilli', 170497, 'ہری مرچ', 5],
  ['red chilli powder', 170932, 'لال مرچ'],
  ['black pepper', 170931, 'کالی مرچ'],
  ['salt', 173468, 'نمک'],
  ['turmeric', 172231, 'ہلدی'],
  ['coriander', 169997, 'دھنیا'],
  ['cumin', 170923, 'زیرہ'],
  ['garam masala', 170924, 'گرم مصالحہ', null, 'USDA equivalent: curry powder (a spice blend)'],
  ['chaat masala', 170924, 'چاٹ مصالحہ', null, 'USDA equivalent: curry powder (a spice blend; chaat masala is saltier)'],
  ['biryani masala', 170924, 'بریانی مصالحہ', null, 'USDA equivalent: curry powder (a spice blend)'],
  ['nihari masala', 170924, 'نہاری مصالحہ', null, 'USDA equivalent: curry powder (a spice blend)'],
  ['cardamom', 170919, 'الائچی'],
  ['cinnamon', 171320, 'دار چینی'],
  ['cloves', 171321, 'لونگ'],
  ['bay leaf', 170917, 'تیز پات'],
  ['fenugreek', 171324, 'میتھی'],
  ['saffron', 170934, 'زعفران'],
  ['kewra', 173647, 'کیوڑہ', null, 'USDA equivalent: water (kewra water is used in drops)'],
  ['mint', 173475, 'پودینہ'],
  ['lemon', 167746, 'لیموں', 60],
  ['tamarind', 167763, 'املی'],
  ['chicken', 171052, 'چکن'],
  ['beef', 168670, 'بیف'],
  ['mutton', 175303, 'مٹن', null, 'USDA equivalent: goat (Pakistani mutton is usually goat)'],
  ['mince', 171796, 'قیمہ', null, 'USDA equivalent: ground beef, 85% lean'],
  ['fish', 171952, 'مچھلی', null, 'USDA equivalent: carp (rohu is a carp)'],
  ['prawns', 175179, 'جھینگے'],
  ['egg', 171287, 'انڈا', 50],
  ['rice', 168877, 'چاول'],
  ['flour', 168893, 'آٹا'],
  ['maida', 168894, 'میدہ'],
  ['gram flour', 174288, 'بیسن'],
  ['semolina', 168933, 'سوجی'],
  ['vermicelli', 169736, 'سویاں', null, 'USDA equivalent: dry enriched pasta'],
  ['sugar', 169655, 'چینی'],
  ['honey', 169640, 'شہد'],
  ['oil', 171411, 'تیل', null, 'USDA equivalent: soybean cooking oil'],
  ['mustard oil', 172337, 'سرسوں کا تیل'],
  ['ghee', 171314, 'گھی'],
  ['butter', 173410, 'مکھن'],
  ['milk', 171265, 'دودھ'],
  ['yogurt', 171284, 'دہی'],
  ['cream', 170859, 'کریم'],
  ['cheese', 170845, 'پنیر (چیز)'],
  ['paneer', 172223, 'پنیر', null, 'USDA equivalent: queso fresco (a fresh, unaged cheese like paneer)'],
  ['lentils', 172420, 'دال'],
  ['red lentils', 174284, 'مسور کی دال'],
  ['yellow lentils', 174256, 'مونگ کی دال', null, 'USDA equivalent: mung beans'],
  ['split chickpeas', 173756, 'چنے کی دال', null, 'USDA equivalent: chickpeas'],
  ['chickpeas', 173756, 'چنے'],
  ['kidney beans', 173744, 'لوبیا'],
  ['spinach', 168462, 'پالک'],
  ['cauliflower', 169986, 'گوبھی'],
  ['cabbage', 169975, 'بند گوبھی'],
  ['peas', 170419, 'مٹر'],
  ['carrot', 170393, 'گاجر', 60],
  ['okra', 169260, 'بھنڈی'],
  ['eggplant', 169228, 'بینگن'],
  ['bottle gourd', 169232, 'لوکی'],
  ['pumpkin', 168448, 'کدو'],
  ['cucumber', 168409, 'کھیرا', 200],
  ['radish', 169276, 'مولی'],
  ['capsicum', 170427, 'شملہ مرچ', 120],
  ['spring onion', 170005, 'ہری پیاز'],
  ['mushroom', 169251, 'مشروم'],
  ['corn', 169998, 'مکئی'],
  ['apple', 171688, 'سیب', 180],
  ['banana', 173944, 'کیلا', 118],
  ['mango', 169910, 'آم', 200],
  ['pomegranate', 169134, 'انار', 280],
  ['dates', 171726, 'کھجور', 7],
  ['almonds', 170567, 'بادام'],
  ['raisins', 168165, 'کشمش'],
  ['coconut', 170169, 'ناریل'],
  ['sesame', 170150, 'تل'],
  ['bread', 174924, 'ڈبل روٹی', 28],
  ['bun', 172796, 'بن', 50],
  ['naan', 171845, 'نان', 90],
  ['paratha', 174076, 'پراٹھا', 80],
  ['yeast', 175043, 'خمیر'],
  ['baking soda', 175040, 'میٹھا سوڈا'],
  ['vinegar', 172237, 'سرکہ'],
  ['soy sauce', 174277, 'سویا ساس'],
  ['ketchup', 168556, 'کیچپ'],
  ['mayonnaise', 171009, 'مایونیز'],
  ['noodles', 169731, 'نوڈلز'],
  ['pasta', 169736, 'پاستا'],
  ['tea', 173227, 'چائے', null, 'Brewed tea (leaves are used in grams, the cup counts as liquid)'],
  ['coffee', 171890, 'کافی'],
  ['water', 173647, 'پانی'],
  ['soft drink', 174852, 'سوفٹ ڈرنک'],
];
/** Canonicals that are not food (fuel, packaging): never mapped. */
const NON_FOOD = ['lpg', 'charcoal', 'packaging', 'food colour'];

// ── 2. Common foods by category, to about 400 ──
const EXTRA = [
  // [category id, include regex, cap]
  ['11', /, raw$|, raw,|\(.*\), raw/, 60],
  ['9', /, raw$|, raw,|^Dates|^Raisins|^Figs, dried|^Apricots, dried|^Prunes/, 45],
  ['2', /^Spices|^Basil|^Dill|^Parsley|^Mustard seed|^Vanilla/, 35],
  ['16', /mature seeds, raw|^Peanuts, all types, raw|^Tofu, raw/, 22],
  ['12', /dried|raw|dry roasted, without salt/, 22],
  ['15', /, raw$|, raw \(|, raw,/, 24],
  ['5', /^Chicken, broilers or fryers.*, raw$|^Turkey, (whole|breast).*raw|^Chicken, liver|^Duck, domesticated, meat only, raw/, 18],
  ['13', /^Beef, (ground, (70|75|80|85|90|93|95)% lean.*raw|.*all grades, raw$)/, 14],
  ['17', /^Lamb, (ground, raw|leg, whole.*choice, raw|shoulder, whole.*choice, raw|rib.*choice, raw|loin.*choice, raw)|^Game meat, goat|^Veal, (ground|leg).*raw/, 12],
  ['1', /^Milk, (whole, 3\.25%|reduced fat, fluid, 2% milkfat, with added vitamin A|lowfat, fluid, 1%|nonfat, fluid, with added vitamin A|dry, whole|canned, condensed|canned, evaporated)|^Yogurt, (plain|Greek, plain)|^Cheese, (cheddar$|mozzarella|parmesan, grated|feta|cottage, creamed, large|cream$|ricotta|swiss$|pasteurized process, American|provolone|fresh, queso)|^Cream, (fluid|sour, cultured)|^Egg, (whole|white|yolk), raw, fresh|^Butter, |^Whey/, 28],
  ['4', /^Oil, (canola|soybean, salad or cooking$|sunflower, high oleic|corn, industrial|olive|mustard|coconut|sesame|peanut|palm)|^Margarine, regular, 80% fat|^Shortening, vegetable/, 12],
  ['19', /^Sugars, (granulated|brown|powdered)|^Honey|^Molasses|^Syrups, maple|^Cocoa, dry powder, unsweetened$|^Chocolate, dark, 70-85%|^Ice creams, (vanilla|chocolate)$|^Jams and preserves$|^Candies, milk chocolate$|^Gelatin desserts, dry mix$/, 14],
  ['18', /^Bread, (white, commercially prepared \(includes|whole-wheat, commercially prepared$|naan|chapati|paratha|pita|multi-grain)|^Rolls, (hamburger|dinner, plain)|^Cookies, butter|^Cake, pound|^Crackers, standard snack|^Croissants, butter|^Puff pastry|^Bagels, plain|^English muffins, plain|^Tortillas, ready-to-bake/, 15],
  ['20', /^(Rice, (white|brown|wild)|Wheat flour|Wheat, durum|Semolina|Oats$|Barley, pearled, raw|Millet, raw|Sorghum grain|Corn flour|Cornmeal|Cornstarch|Pasta, dry|Noodles, (egg, dry|rice, dry)|Couscous, dry|Quinoa, uncooked|Buckwheat$|Rye flour)/, 22],
  ['14', /^Beverages, (tea, black, brewed, prepared with tap|tea, green, brewed, regular|coffee, brewed, prepared with tap|water, tap|carbonated, cola, regular|carbonated, lemon-lime soda|orange juice drink)|^Orange juice, raw|^Lemon juice, raw|^Lime juice, raw/, 10],
  ['6', /^(Sauce, (ready-to-serve, pepper or hot|pasta, spaghetti\/marinara, ready-to-serve|barbecue|worcestershire|oyster)|Soup, chicken broth, ready-to-serve)/, 6],
  ['8', /^Cereals ready-to-eat, (granola|corn flakes)|^Cereals, oats, regular and quick, not fortified, dry/, 4],
];
const EXCLUDE = /pork|\bham\b|bacon|lard|wine|beer|alcohol|Alaska Native|Hawaii|baby|infant|NFS|Babyfood/i;

const out = new Map();
const add = (fdc, base) => {
  const f = foods.get(fdc);
  const v = values.get(fdc);
  if (!f || !v) throw new Error(`fdc ${fdc} not found`);
  if (out.has(fdc)) {
    if (base.canonicals?.length) out.get(fdc).canonicals.push(...base.canonicals);
    return;
  }
  const r2 = (n) => Math.round((n ?? 0) * 100) / 100;
  out.set(fdc, {
    key: base.key,
    name: base.name ?? clean(f.description),
    nameUr: base.nameUr ?? null,
    canonicals: base.canonicals ?? [],
    group: f.food_category_id,
    fdcId: fdc,
    usdaDescription: clean(f.description),
    kcal: Math.round(v.kcal ?? 0),
    proteinG: r2(v.proteinG),
    carbsG: r2(v.carbsG),
    fatG: r2(v.fatG),
    fibreG: r2(v.fibreG),
    sodiumMg: Math.round(v.sodiumMg ?? 0),
    pieceGrams: base.pieceGrams ?? null,
    note: base.note ?? null,
  });
};
const title = (s) => s.charAt(0).toUpperCase() + s.slice(1);
for (const [canonical, fdc, ur, piece, note] of CANONICAL)
  add(fdc, {
    key: slug(canonical),
    name: note ? title(canonical) : `${title(canonical)} (${clean(foods.get(fdc).description)})`,
    nameUr: ur,
    canonicals: [canonical],
    pieceGrams: piece ?? null,
    note: note ?? null,
  });
const used = new Set([...out.values()].map((r) => r.key));
for (const [cat, rx, cap] of EXTRA) {
  const picked = [...foods.values()]
    .filter((f) => f.food_category_id === cat && rx.test(f.description) && !EXCLUDE.test(f.description))
    .filter((f) => !out.has(Number(f.fdc_id)) && values.has(Number(f.fdc_id)))
    .sort((a, b) => a.description.length - b.description.length || Number(a.fdc_id) - Number(b.fdc_id))
    .slice(0, cap);
  for (const f of picked) {
    let key = slug(clean(f.description));
    for (let i = 2; used.has(key); i++) key = `${slug(clean(f.description)).slice(0, 56)}-${i}`;
    used.add(key);
    add(Number(f.fdc_id), { key });
  }
}
const rows = [...out.values()].sort((a, b) => a.key.localeCompare(b.key));

const GROUPS = Object.fromEntries(table('food_category.csv').map((c) => [c.id, c.description]));
const body = rows
  .map((r) => `  ${JSON.stringify({ ...r, group: GROUPS[r.group] })},`)
  .join('\n');
const file = `/**
 * Nutrition reference foods — GENERATED by scripts/build-nutrition-seed.mjs; do not edit by hand.
 *
 * Source: USDA FoodData Central, SR Legacy (April 2018), public domain (CC0 1.0).
 * Values per 100 g: kcal, protein / carbohydrate (by difference) / fat / fibre in g, sodium in mg.
 * \`canonicals\` link a food to the kitchen's canonical ingredient names
 * (ingredient_aliases); \`note\` labels a USDA equivalent used for a local item.
 * \`pieceGrams\`: a typical weight for ingredients counted in pieces.
 */
export interface NutritionFoodSeed {
  key: string;
  name: string;
  nameUr: string | null;
  canonicals: string[];
  group: string;
  fdcId: number;
  usdaDescription: string;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fibreG: number;
  sodiumMg: number;
  pieceGrams: number | null;
  note: string | null;
}

/** Canonical ingredient names that are not food: never mapped. */
export const NON_FOOD_CANONICALS = ${JSON.stringify(NON_FOOD)};

export const NUTRITION_FOODS: NutritionFoodSeed[] = [
${body}
];
`;
const target = join(root, 'src/database/seeds/nutrition/nutrition-foods.data.ts');
writeFileSync(target, file);
console.log(`${target}: ${rows.length} foods (${CANONICAL.length} canonical mappings)`);
