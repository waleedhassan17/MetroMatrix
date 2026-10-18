import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * What Pakistani kitchens call their ingredients: canonical English name,
 * then other English, Roman Urdu and Urdu-script names. The canonical name
 * is an alias of itself. Staff can add more (admin aliases CRUD).
 */
export const INGREDIENT_ALIASES: Array<
  [canonical: string, en: string[], roman: string[], ur: string[]]
> = [
  ['tomato', ['tomatoes'], ['tamatar', 'timatar'], ['ٹماٹر']],
  ['onion', ['onions'], ['piyaz', 'pyaz', 'piaz'], ['پیاز']],
  ['potato', ['potatoes'], ['aloo', 'alu'], ['آلو']],
  ['garlic', [], ['lehsan', 'lahsun', 'lehson'], ['لہسن']],
  ['ginger', [], ['adrak'], ['ادرک']],
  [
    'green chilli',
    ['green chillies', 'green chili'],
    ['hari mirch'],
    ['ہری مرچ'],
  ],
  [
    'red chilli powder',
    ['red chilli', 'chilli powder'],
    ['lal mirch'],
    ['لال مرچ'],
  ],
  ['black pepper', ['pepper'], ['kali mirch'], ['کالی مرچ']],
  ['salt', [], ['namak'], ['نمک']],
  ['turmeric', [], ['haldi'], ['ہلدی']],
  [
    'coriander',
    ['cilantro', 'coriander leaves'],
    ['dhania', 'dhaniya', 'hara dhania'],
    ['دھنیا'],
  ],
  ['cumin', ['cumin seeds'], ['zeera', 'jeera'], ['زیرہ']],
  ['garam masala', [], [], ['گرم مصالحہ']],
  ['chaat masala', [], [], ['چاٹ مصالحہ']],
  ['biryani masala', [], [], ['بریانی مصالحہ']],
  ['nihari masala', [], [], ['نہاری مصالحہ']],
  ['cardamom', ['green cardamom'], ['elaichi', 'ilaichi'], ['الائچی']],
  ['cinnamon', [], ['darchini', 'dalchini'], ['دار چینی']],
  ['cloves', ['clove'], ['laung'], ['لونگ']],
  ['bay leaf', ['bay leaves'], ['tez patta'], ['تیز پات']],
  ['fenugreek', ['kasuri methi'], ['methi'], ['میتھی']],
  ['saffron', [], ['zafran', 'zafraan'], ['زعفران']],
  ['kewra', ['kewra water'], [], ['کیوڑہ']],
  ['food colour', ['food color'], ['zarda rang'], ['رنگ']],
  ['mint', ['mint leaves'], ['podina', 'pudina'], ['پودینہ']],
  ['lemon', ['lemons', 'lime'], ['nimbu', 'leemu', 'limu'], ['لیموں']],
  ['tamarind', [], ['imli'], ['املی']],
  [
    'chicken',
    ['chicken meat'],
    ['murgh', 'murghi', 'murgi'],
    ['مرغی', 'مرغ', 'چکن'],
  ],
  ['beef', [], ['bara gosht', 'gaye ka gosht'], ['بڑا گوشت', 'گائے کا گوشت']],
  [
    'mutton',
    ['goat meat', 'lamb'],
    ['bakra gosht', 'chota gosht'],
    ['مٹن', 'چھوٹا گوشت', 'بکرے کا گوشت'],
  ],
  ['mince', ['minced meat', 'keema'], ['qeema', 'kima'], ['قیمہ']],
  ['fish', [], ['machli', 'machhli'], ['مچھلی']],
  ['prawns', ['shrimp'], ['jhinga'], ['جھینگا']],
  ['egg', ['eggs'], ['anda', 'anday', 'ande'], ['انڈا', 'انڈے']],
  ['rice', ['basmati rice', 'basmati'], ['chawal', 'chawul'], ['چاول']],
  ['flour', ['wheat flour', 'atta'], ['aata'], ['آٹا']],
  ['maida', ['all purpose flour', 'plain flour'], [], ['میدہ']],
  ['gram flour', ['besan'], [], ['بیسن']],
  ['semolina', [], ['suji', 'sooji'], ['سوجی']],
  ['vermicelli', [], ['sewaiyan', 'seviyan'], ['سویاں']],
  ['sugar', [], ['cheeni', 'chini', 'shakar'], ['چینی']],
  ['honey', [], ['shehad', 'shahad'], ['شہد']],
  ['oil', ['cooking oil', 'vegetable oil'], ['tel'], ['تیل']],
  ['mustard oil', [], ['sarson ka tel'], ['سرسوں کا تیل']],
  ['ghee', ['clarified butter'], ['desi ghee', 'banaspati'], ['گھی']],
  ['butter', [], ['makhan', 'makkhan'], ['مکھن']],
  ['milk', [], ['doodh', 'dudh'], ['دودھ']],
  ['yogurt', ['yoghurt', 'curd'], ['dahi'], ['دہی']],
  ['cream', ['fresh cream'], ['malai'], ['ملائی', 'کریم']],
  ['cheese', ['mozzarella', 'cheddar'], ['cheez'], ['چیز']],
  ['paneer', ['cottage cheese'], [], ['پنیر']],
  ['lentils', ['daal', 'dal'], [], ['دال']],
  ['red lentils', ['masoor'], ['masoor daal'], ['مسور']],
  ['yellow lentils', ['moong'], ['moong daal'], ['مونگ']],
  ['split chickpeas', ['chana daal'], ['chane ki daal'], ['چنے کی دال']],
  [
    'chickpeas',
    ['chickpea', 'garbanzo'],
    ['chane', 'chanay', 'cholay', 'chole'],
    ['چنے', 'چھولے'],
  ],
  ['kidney beans', ['red beans'], ['lobia', 'rajma'], ['لوبیا']],
  ['spinach', [], ['palak'], ['پالک']],
  [
    'cauliflower',
    [],
    ['gobhi', 'gobi', 'phool gobhi'],
    ['گوبھی', 'پھول گوبھی'],
  ],
  ['cabbage', [], ['band gobhi'], ['بند گوبھی']],
  ['peas', ['green peas'], ['matar', 'mattar'], ['مٹر']],
  ['carrot', ['carrots'], ['gajar'], ['گاجر']],
  ['okra', ['lady finger'], ['bhindi'], ['بھنڈی']],
  ['eggplant', ['aubergine', 'brinjal'], ['baingan', 'bengan'], ['بینگن']],
  ['bottle gourd', [], ['lauki', 'ghiya'], ['لوکی']],
  ['pumpkin', [], ['kaddu'], ['کدو']],
  ['cucumber', [], ['kheera', 'khira'], ['کھیرا']],
  ['radish', [], ['mooli', 'muli'], ['مولی']],
  ['capsicum', ['bell pepper', 'green pepper'], ['shimla mirch'], ['شملہ مرچ']],
  ['spring onion', ['green onion', 'scallion'], ['hara pyaz'], ['ہرا پیاز']],
  ['mushroom', ['mushrooms'], ['khumbi'], ['کھمبی']],
  ['corn', ['maize', 'sweet corn'], ['makai', 'makki', 'butta'], ['مکئی']],
  ['apple', ['apples'], ['saib', 'seb'], ['سیب']],
  ['banana', ['bananas'], ['kela', 'kelay'], ['کیلا', 'کیلے']],
  ['mango', ['mangoes'], ['aam'], ['آم']],
  ['pomegranate', [], ['anar'], ['انار']],
  ['dates', [], ['khajoor', 'khajur'], ['کھجور']],
  ['almonds', ['almond'], ['badam'], ['بادام']],
  ['raisins', [], ['kishmish'], ['کشمش']],
  ['coconut', [], ['nariyal', 'khopra'], ['ناریل']],
  ['sesame', ['sesame seeds'], ['til'], ['تل']],
  ['bread', ['sandwich bread'], ['double roti', 'dabal roti'], ['ڈبل روٹی']],
  ['bun', ['buns', 'burger bun'], [], ['بن']],
  ['naan', [], ['nan'], ['نان']],
  ['paratha', ['frozen paratha'], ['parontha'], ['پراٹھا']],
  ['yeast', [], ['khameer'], ['خمیر']],
  ['baking soda', [], ['meetha soda'], ['میٹھا سوڈا']],
  ['vinegar', [], ['sirka'], ['سرکہ']],
  ['soy sauce', ['soya sauce'], [], ['سویا ساس']],
  ['ketchup', ['tomato ketchup'], [], ['کیچپ']],
  ['mayonnaise', ['mayo'], [], ['مایونیز']],
  ['noodles', [], [], ['نوڈلز']],
  ['pasta', ['macaroni', 'spaghetti'], [], ['پاستا']],
  ['tea', ['tea leaves'], ['chai', 'patti', 'chai patti'], ['چائے', 'پتی']],
  ['coffee', [], [], ['کافی']],
  ['water', ['mineral water', 'water bottle'], ['paani', 'pani'], ['پانی']],
  ['soft drink', ['cold drink', 'soft drinks'], ['botal'], ['بوتل']],
  ['lpg', ['gas', 'gas cylinder'], ['silender', 'cylinder'], ['سلنڈر', 'گیس']],
  ['charcoal', ['coal'], ['koyla', 'koila'], ['کوئلہ']],
  ['packaging', ['takeaway box', 'box', 'boxes'], ['dabba', 'dibba'], ['ڈبہ']],
];

const aliasRows = (): Array<[alias: string, canonical: string, lang: string]> =>
  INGREDIENT_ALIASES.flatMap(([canonical, en, roman, ur]) => [
    [canonical, canonical, 'en'] as [string, string, string],
    ...en.map((a) => [a, canonical, 'en'] as [string, string, string]),
    ...roman.map((a) => [a, canonical, 'roman'] as [string, string, string]),
    ...ur.map((a) => [a, canonical, 'ur'] as [string, string, string]),
  ]);

export class KitchenAliasesSeed1792362400000 implements MigrationInterface {
  name = 'KitchenAliasesSeed1792362400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const rows = aliasRows();
    await queryRunner.query(
      `INSERT INTO ingredient_aliases (alias, canonical, lang)
       SELECT * FROM unnest($1::text[], $2::text[], $3::text[]) ON CONFLICT (alias) DO NOTHING`,
      [rows.map((r) => r[0]), rows.map((r) => r[1]), rows.map((r) => r[2])],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM ingredient_aliases WHERE alias = ANY($1::citext[])`,
      [aliasRows().map((r) => r[0])],
    );
  }
}
