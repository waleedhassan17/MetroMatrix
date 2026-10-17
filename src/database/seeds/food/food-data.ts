/**
 * The Food Court demo: six fictional vendors in Lahore and Karachi. No real
 * brand, name or logo — every brand here is made up and its tagline says it
 * is a demo. Dish and cover photos are Unsplash photos of food (no brands or
 * readable names; credits in CREDITS.md); logos are generated monograms.
 */

export type DemoSubType = 'restaurant' | 'cloud_kitchen' | 'home_kitchen';

/** Unsplash photo ids (images.unsplash.com/<id>), each credited in CREDITS.md. */
export const FOOD_PHOTOS = {
  biryani: 'photo-1589302168068-964664d93dc0',
  chickenPulao: 'photo-1631515243349-e0cb75fb8d3a',
  handiBiryani: 'photo-1563379091339-03b21ab4a4f8',
  chickenKarahi: 'photo-1603496987351-f84a3ba5ec85',
  qorma: 'photo-1708782344490-9026aaa5eec7',
  karahiPan: 'photo-1708782340793-ec5f2159a689',
  handi: 'photo-1694579740719-0e601c5d2437',
  skewersGrill: 'photo-1599487488170-d11ec9c172f0',
  bbqPlatter: 'photo-1781332146555-5507a0fc9bc9',
  butterChicken: 'photo-1772730064970-a7b2735c93b9',
  malaiBoti: 'photo-1605908580297-f3e1c02e64ff',
  paratha: 'photo-1708783741187-ff1d081d87da',
  naan: 'photo-1611107415406-1c12f8cda424',
  daal: 'photo-1788601988466-9f361c34c6cb',
  thali: 'photo-1546833999-b9f581a1996d',
  burger: 'photo-1568901346375-23c9450c58cd',
  doubleBurger: 'photo-1572802419224-296b0aeee0d9',
  smashBurger: 'photo-1607013251379-e6eecfffe234',
  pizzaMargherita: 'photo-1513104890138-7c749659a591',
  pizzaTikka: 'photo-1565299624946-b28f40a0ae38',
  pizzaPepperoni: 'photo-1534308983496-4fabb1a015ee',
  fries: 'photo-1630384060421-cb20d0e0649d',
  shawarma: 'photo-1529006557810-274b9b2fc783',
  wraps: 'photo-1778168199427-4e839943d20f',
  samosa: 'photo-1601050690597-df0568f70950',
  chai: 'photo-1762708156343-26472227daeb',
  gulabJamun: 'photo-1593701461250-d7b22dfd3a77',
  pakora: 'photo-1765360024331-25b63e85272e',
} as const;
export type FoodPhoto = keyof typeof FOOD_PHOTOS;

/** A square dish photo, or a 2:1 cover crop. */
export const dishPhotoUrl = (key: FoodPhoto) =>
  `https://images.unsplash.com/${FOOD_PHOTOS[key]}?w=800&h=800&fit=crop&q=80&auto=format`;
export const coverPhotoUrl = (key: FoodPhoto) =>
  `https://images.unsplash.com/${FOOD_PHOTOS[key]}?w=1600&h=800&fit=crop&q=80&auto=format`;

export interface DemoOptionGroup {
  key: string;
  name: string;
  min: number;
  max: number;
  options: Array<[name: string, priceDelta: number, isDefault?: boolean]>;
}

export interface DemoItem {
  name: string;
  description: string;
  price: number;
  photo?: FoodPhoto;
  tags?: Array<'spicy' | 'veg' | 'bestseller' | 'new' | 'contains_nuts'>;
  /** Sizes; the item's price is ignored when present (cheapest is the "from" price). */
  variants?: Array<[name: string, price: number]>;
  groups?: string[];
  serves?: number;
  isDeal?: boolean;
  /** Days on the menu (0 = Sunday); every day when absent. */
  days?: number[];
  /** Home kitchens with portions: today's count. */
  portions?: number;
}

export interface DemoCategory {
  name: string;
  /** Daily window, e.g. breakfast 07:00–11:30. */
  window?: [from: string, to: string];
  items: DemoItem[];
}

export interface DemoVendor {
  key: string;
  name: string;
  subType: DemoSubType;
  tagline: string;
  city: 'Lahore' | 'Karachi';
  area: string;
  addressLine: string;
  lat: number;
  lng: number;
  phone: string;
  cuisines: string[];
  priceLevel: 1 | 2 | 3;
  brandColor: string;
  cover: FoodPhoto;
  prepMinutes: number;
  acceptsDelivery: boolean;
  acceptsPickup: boolean;
  codLimit: number;
  freeDeliveryOver: number | null;
  preorderOnly?: boolean;
  /** [weekday, opens, closes] — closes ≤ opens runs past midnight. */
  hours: Array<[number, string, string]>;
  bands: Array<{ fromKm: number; toKm: number; fee: number; minOrder: number }>;
  maxRadiusKm: number;
  slots?: Array<{
    weekday: number;
    start: string;
    cutoff: number;
    max: number;
  }>;
  groups: DemoOptionGroup[];
  menu: DemoCategory[];
  riders?: Array<{
    name: string;
    vehicle: 'bike' | 'bicycle' | 'car' | 'on_foot';
  }>;
  deals: Array<{
    title: string;
    kind:
      'percent_off_order' | 'percent_off_items' | 'flat_off' | 'free_delivery';
    value: number;
    minOrder?: number;
    maxDiscount?: number;
    code?: string;
    /** percent_off_items: item names. */
    items?: string[];
    timeFrom?: string;
    timeTo?: string;
    weekdays?: number[];
  }>;
  /** Past orders to create (delivered or collected), spread over 30 days. */
  pastOrders: number;
}

const EVERY = [0, 1, 2, 3, 4, 5, 6];
const daily = (
  opens: string,
  closes: string,
): Array<[number, string, string]> => EVERY.map((d) => [d, opens, closes]);

const SPICE: DemoOptionGroup = {
  key: 'spice',
  name: 'Spice level',
  min: 1,
  max: 1,
  options: [
    ['Mild', 0],
    ['Medium', 0, true],
    ['Hot', 0],
  ],
};

export const DEMO_VENDORS: DemoVendor[] = [
  {
    key: 'qandeel',
    name: 'Qandeel Karahi House',
    subType: 'restaurant',
    tagline: 'Coal-fired karahi and BBQ · demo vendor (fictional)',
    city: 'Lahore',
    area: 'Gulberg III',
    addressLine: '41-C Main Boulevard (demo)',
    lat: 31.5161,
    lng: 74.3467,
    phone: '042 35710041',
    cuisines: ['pakistani', 'karahi', 'bbq'],
    priceLevel: 2,
    brandColor: '#9A3412',
    cover: 'karahiPan',
    prepMinutes: 25,
    acceptsDelivery: true,
    acceptsPickup: true,
    codLimit: 15000,
    freeDeliveryOver: null,
    // Lunch, then dinner into the night (Fri/Sat until 2 am).
    hours: [
      ...EVERY.map((d) => [d, '12:00', '15:30'] as [number, string, string]),
      ...EVERY.map(
        (d) =>
          [d, '18:30', d === 5 || d === 6 ? '02:00' : '00:30'] as [
            number,
            string,
            string,
          ],
      ),
    ],
    bands: [
      { fromKm: 0, toKm: 3, fee: 99, minOrder: 500 },
      { fromKm: 3, toKm: 6, fee: 149, minOrder: 800 },
      { fromKm: 6, toKm: 8, fee: 199, minOrder: 1200 },
    ],
    maxRadiusKm: 8,
    groups: [
      SPICE,
      {
        key: 'breads',
        name: 'Add breads',
        min: 0,
        max: 4,
        options: [
          ['Tandoori roti', 30],
          ['Plain naan', 50],
          ['Garlic naan', 90],
          ['Roghni naan', 80],
        ],
      },
    ],
    menu: [
      {
        name: 'Karahi',
        items: [
          {
            name: 'Chicken Karahi',
            description:
              'Tomato, green chilli and ginger, finished in the wok over coal.',
            price: 1450,
            photo: 'chickenKarahi',
            tags: ['bestseller', 'spicy'],
            variants: [
              ['Half (serves 2)', 1450],
              ['Full (serves 4)', 2700],
            ],
            groups: ['spice', 'breads'],
          },
          {
            name: 'Mutton Karahi',
            description: 'Bone-in mutton, slow-cooked then charred.',
            price: 2600,
            photo: 'karahiPan',
            tags: ['spicy'],
            variants: [
              ['Half (serves 2)', 2600],
              ['Full (serves 4)', 4900],
            ],
            groups: ['spice', 'breads'],
          },
          {
            name: 'White Karahi',
            description: 'Cream, yoghurt and black pepper — no tomato.',
            price: 1650,
            photo: 'qorma',
            variants: [
              ['Half (serves 2)', 1650],
              ['Full (serves 4)', 3100],
            ],
            groups: ['breads'],
          },
          {
            name: 'Chicken Handi',
            description: 'Boneless chicken in a clay pot, butter and cream.',
            price: 1550,
            photo: 'handi',
            groups: ['spice', 'breads'],
          },
        ],
      },
      {
        name: 'BBQ',
        items: [
          {
            name: 'Chicken Tikka',
            description: 'Leg and breast quarter, overnight marinade.',
            price: 520,
            photo: 'skewersGrill',
            tags: ['spicy'],
          },
          {
            name: 'Malai Boti',
            description: 'Creamy boneless chunks off the coal.',
            price: 890,
            photo: 'malaiBoti',
            tags: ['bestseller'],
          },
          {
            name: 'Seekh Kebab (4)',
            description: 'Hand-pressed beef seekh, mint chutney.',
            price: 780,
            photo: 'bbqPlatter',
          },
          {
            name: 'Family BBQ Platter',
            description: 'Tikka, malai boti, seekh and four naans.',
            price: 3400,
            photo: 'bbqPlatter',
            isDeal: true,
            serves: 4,
          },
        ],
      },
      {
        name: 'Breads',
        items: [
          {
            name: 'Tandoori Roti',
            description: 'Whole wheat.',
            price: 30,
            photo: 'naan',
            tags: ['veg'],
          },
          {
            name: 'Garlic Naan',
            description: 'Butter and garlic.',
            price: 90,
            photo: 'naan',
            tags: ['veg'],
          },
          {
            name: 'Roghni Naan',
            description: 'Sesame, soft.',
            price: 80,
            photo: 'naan',
            tags: ['veg'],
          },
        ],
      },
      {
        name: 'Sides & drinks',
        items: [
          {
            name: 'Raita',
            description: 'Cucumber and mint.',
            price: 120,
            tags: ['veg'],
          },
          {
            name: 'Fresh Salad',
            description: 'Onion, tomato, cucumber, lemon.',
            price: 100,
            tags: ['veg'],
          },
          {
            name: 'Gulab Jamun (2)',
            description: 'Warm, in syrup.',
            price: 220,
            photo: 'gulabJamun',
            tags: ['veg'],
          },
          {
            name: 'Doodh Patti Chai',
            description: 'Strong, milky, cardamom.',
            price: 120,
            photo: 'chai',
            tags: ['veg'],
          },
          {
            name: 'Mint Margarita',
            description: 'Lemon, mint, crushed ice.',
            price: 260,
            tags: ['veg'],
          },
        ],
      },
    ],
    riders: [
      { name: 'Imran Ali', vehicle: 'bike' },
      { name: 'Waqas Javed', vehicle: 'bike' },
    ],
    deals: [
      {
        title: 'Big family order',
        kind: 'percent_off_order',
        value: 10,
        minOrder: 3000,
        maxDiscount: 600,
      },
      {
        title: 'Karahi Tuesdays',
        kind: 'percent_off_items',
        value: 15,
        items: ['Chicken Karahi', 'Mutton Karahi'],
        weekdays: [2],
        code: 'KARAHI15',
      },
    ],
    pastOrders: 14,
  },
  {
    key: 'zafran',
    name: 'Zafran Biryani Kitchen',
    subType: 'restaurant',
    tagline: 'Dum biryani, pulao and qorma · demo vendor (fictional)',
    city: 'Lahore',
    area: 'Model Town',
    addressLine: '7 Link Road (demo)',
    lat: 31.4834,
    lng: 74.3256,
    phone: '042 35880107',
    cuisines: ['biryani', 'pakistani'],
    priceLevel: 1,
    brandColor: '#B45309',
    cover: 'biryani',
    prepMinutes: 15,
    acceptsDelivery: true,
    acceptsPickup: true,
    codLimit: 8000,
    freeDeliveryOver: 2500,
    hours: daily('11:30', '23:30'),
    bands: [
      { fromKm: 0, toKm: 4, fee: 79, minOrder: 400 },
      { fromKm: 4, toKm: 7, fee: 129, minOrder: 600 },
    ],
    maxRadiusKm: 7,
    groups: [
      {
        key: 'extras',
        name: 'Extras',
        min: 0,
        max: 3,
        options: [
          ['Extra raita', 60],
          ['Shami kebab', 120],
          ['Boiled egg', 50],
        ],
      },
    ],
    menu: [
      {
        name: 'Biryani',
        items: [
          {
            name: 'Chicken Biryani',
            description:
              'Long-grain rice, saffron, fried onions; raita and salad.',
            price: 420,
            photo: 'biryani',
            tags: ['bestseller', 'spicy'],
            variants: [
              ['Single', 420],
              ['Double', 780],
              ['Family (serves 4)', 1500],
            ],
            groups: ['extras'],
          },
          {
            name: 'Beef Biryani',
            description: 'Tender beef, aloo bukhara, extra masala.',
            price: 480,
            photo: 'handiBiryani',
            tags: ['spicy'],
            variants: [
              ['Single', 480],
              ['Double', 880],
            ],
            groups: ['extras'],
          },
          {
            name: 'Sindhi Biryani',
            description: 'Potatoes, plums and a sharper masala.',
            price: 450,
            photo: 'handiBiryani',
            tags: ['spicy'],
            groups: ['extras'],
          },
          {
            name: 'Chicken Pulao',
            description: 'Yakhni rice, gentle spice.',
            price: 380,
            photo: 'chickenPulao',
            groups: ['extras'],
          },
        ],
      },
      {
        name: 'Curries',
        items: [
          {
            name: 'Chicken Qorma',
            description: 'Yoghurt, brown onion, kewra.',
            price: 650,
            photo: 'qorma',
          },
          {
            name: 'Aloo Gosht',
            description: 'Beef and potato, home-style.',
            price: 690,
            photo: 'handi',
          },
          {
            name: 'Daal Mash',
            description: 'White lentils, tarka.',
            price: 350,
            photo: 'daal',
            tags: ['veg'],
          },
        ],
      },
      {
        name: 'Desserts & drinks',
        items: [
          {
            name: 'Zarda',
            description: 'Sweet saffron rice, nuts.',
            price: 220,
            tags: ['veg', 'contains_nuts'],
          },
          {
            name: 'Kheer',
            description: 'Rice pudding, cardamom.',
            price: 200,
            tags: ['veg', 'contains_nuts'],
          },
          {
            name: 'Salted Lassi',
            description: 'Chilled.',
            price: 180,
            tags: ['veg'],
          },
        ],
      },
    ],
    deals: [
      {
        title: 'Afternoon biryani',
        kind: 'percent_off_order',
        value: 15,
        timeFrom: '15:00',
        timeTo: '18:00',
        maxDiscount: 300,
      },
    ],
    pastOrders: 16,
  },
  {
    key: 'sahil',
    name: 'Sahil Tikka & Pizza Oven',
    subType: 'restaurant',
    tagline: 'Seaside BBQ and stone-baked pizza · demo vendor (fictional)',
    city: 'Karachi',
    area: 'Clifton Block 4',
    addressLine: 'Shop 3, 26th Street (demo)',
    lat: 24.8138,
    lng: 67.0299,
    phone: '021 35870326',
    cuisines: ['bbq', 'pizza', 'fast-food'],
    priceLevel: 2,
    brandColor: '#0F766E',
    cover: 'pizzaMargherita',
    prepMinutes: 20,
    acceptsDelivery: true,
    acceptsPickup: true,
    codLimit: 12000,
    freeDeliveryOver: null,
    hours: daily('17:00', '03:00'),
    bands: [
      { fromKm: 0, toKm: 3, fee: 120, minOrder: 600 },
      { fromKm: 3, toKm: 6, fee: 180, minOrder: 900 },
    ],
    maxRadiusKm: 6,
    groups: [
      {
        key: 'crust',
        name: 'Crust',
        min: 1,
        max: 1,
        options: [
          ['Hand-tossed', 0, true],
          ['Thin crust', 0],
          ['Stuffed crust', 250],
        ],
      },
      {
        key: 'toppings',
        name: 'Extra toppings',
        min: 0,
        max: 3,
        options: [
          ['Extra cheese', 180],
          ['Jalapeños', 90],
          ['Olives', 90],
          ['Mushrooms', 120],
        ],
      },
      { ...SPICE, key: 'spice' },
    ],
    menu: [
      {
        name: 'Pizza',
        items: [
          {
            name: 'Chicken Tikka Pizza',
            description: 'Tikka chunks, onion, green chilli, mozzarella.',
            price: 950,
            photo: 'pizzaTikka',
            tags: ['bestseller', 'spicy'],
            variants: [
              ['Small 8"', 950],
              ['Medium 12"', 1650],
              ['Large 16"', 2350],
            ],
            groups: ['crust', 'toppings'],
          },
          {
            name: 'Margherita',
            description: 'Tomato, mozzarella, basil.',
            price: 850,
            photo: 'pizzaMargherita',
            tags: ['veg'],
            variants: [
              ['Small 8"', 850],
              ['Medium 12"', 1450],
              ['Large 16"', 2050],
            ],
            groups: ['crust', 'toppings'],
          },
          {
            name: 'Beef Pepperoni',
            description: 'Halal beef pepperoni, double cheese.',
            price: 1050,
            photo: 'pizzaPepperoni',
            variants: [
              ['Small 8"', 1050],
              ['Medium 12"', 1850],
              ['Large 16"', 2550],
            ],
            groups: ['crust', 'toppings'],
          },
        ],
      },
      {
        name: 'BBQ',
        items: [
          {
            name: 'Behari Boti',
            description: 'Thin-cut beef, papaya marinade.',
            price: 990,
            photo: 'skewersGrill',
            tags: ['spicy'],
            groups: ['spice'],
          },
          {
            name: 'Chicken Malai Tikka',
            description: 'Cream and cheese marinade.',
            price: 920,
            photo: 'malaiBoti',
            groups: ['spice'],
          },
          {
            name: 'Reshmi Kebab',
            description: 'Silky chicken mince.',
            price: 850,
            photo: 'bbqPlatter',
          },
          {
            name: 'Butter Chicken',
            description: 'Tikka in a tomato-butter gravy, with naan.',
            price: 1150,
            photo: 'butterChicken',
          },
        ],
      },
      {
        name: 'Sides',
        items: [
          {
            name: 'Masala Fries',
            description: 'Chaat masala, garlic mayo.',
            price: 350,
            photo: 'fries',
            tags: ['veg'],
          },
          {
            name: 'Garlic Bread',
            description: 'Four slices, cheese pull.',
            price: 390,
            tags: ['veg'],
          },
          {
            name: 'Chicken Wings (6)',
            description: 'Honey-chilli glaze.',
            price: 690,
            tags: ['spicy'],
          },
        ],
      },
    ],
    riders: [
      { name: 'Asif Baloch', vehicle: 'bike' },
      { name: 'Danish Raza', vehicle: 'bike' },
    ],
    deals: [
      {
        title: 'Pizza night',
        kind: 'percent_off_items',
        value: 20,
        code: 'PIZZA20',
        items: ['Chicken Tikka Pizza', 'Margherita', 'Beef Pepperoni'],
      },
      {
        title: 'Rs 200 off big orders',
        kind: 'flat_off',
        value: 200,
        minOrder: 2500,
      },
    ],
    pastOrders: 12,
  },
  {
    key: 'smash',
    name: 'Smash Theory Burgers',
    subType: 'cloud_kitchen',
    tagline:
      'Smash burgers, loaded fries, wraps · delivery only · demo vendor (fictional)',
    city: 'Lahore',
    area: 'Cavalry Ground',
    addressLine: 'Kitchen 12, Commercial Area (demo)',
    lat: 31.4989,
    lng: 74.3712,
    phone: '042 37180512',
    cuisines: ['burgers', 'fast-food', 'shawarma'],
    priceLevel: 2,
    brandColor: '#1F2937',
    cover: 'smashBurger',
    prepMinutes: 15,
    acceptsDelivery: true,
    acceptsPickup: false,
    codLimit: 6000,
    freeDeliveryOver: null,
    hours: daily('13:00', '02:00'),
    bands: [
      { fromKm: 0, toKm: 3, fee: 89, minOrder: 600 },
      { fromKm: 3, toKm: 6, fee: 149, minOrder: 800 },
    ],
    maxRadiusKm: 6,
    groups: [
      {
        key: 'patty',
        name: 'Patty',
        min: 1,
        max: 1,
        options: [
          ['Beef', 0, true],
          ['Crispy chicken', 0],
        ],
      },
      {
        key: 'addons',
        name: 'Add-ons',
        min: 0,
        max: 4,
        options: [
          ['Extra cheese slice', 80],
          ['Jalapeños', 60],
          ['Caramelised onion', 70],
          ['Fried egg', 90],
        ],
      },
      {
        key: 'meal',
        name: 'Make it a meal',
        min: 0,
        max: 1,
        options: [['Fries + drink', 390]],
      },
    ],
    menu: [
      {
        name: 'Burgers',
        items: [
          {
            name: 'Classic Smash',
            description:
              'Smashed patty, American cheese, pickles, house sauce.',
            price: 790,
            photo: 'smashBurger',
            tags: ['bestseller'],
            variants: [
              ['Single', 790],
              ['Double', 1090],
            ],
            groups: ['patty', 'addons', 'meal'],
          },
          {
            name: 'Jalapeño Melt',
            description: 'Pepper jack, jalapeños, chipotle mayo.',
            price: 890,
            photo: 'doubleBurger',
            tags: ['spicy'],
            variants: [
              ['Single', 890],
              ['Double', 1190],
            ],
            groups: ['patty', 'addons', 'meal'],
          },
          {
            name: 'Garden Burger',
            description: 'Lettuce, tomato, onion, cheese — a lighter stack.',
            price: 750,
            photo: 'burger',
            groups: ['patty', 'addons', 'meal'],
          },
        ],
      },
      {
        name: 'Wraps & shawarma',
        items: [
          {
            name: 'Chicken Shawarma',
            description: 'Garlic sauce, pickles, fries inside.',
            price: 450,
            photo: 'shawarma',
          },
          {
            name: 'Zinger Wrap',
            description: 'Crispy chicken, lettuce, spicy mayo.',
            price: 620,
            photo: 'wraps',
            tags: ['spicy'],
          },
        ],
      },
      {
        name: 'Fries & sides',
        items: [
          {
            name: 'Fries',
            description: 'Skin-on, sea salt.',
            price: 290,
            photo: 'fries',
            tags: ['veg'],
            variants: [
              ['Regular', 290],
              ['Large', 420],
            ],
          },
          {
            name: 'Loaded Fries',
            description: 'Cheese sauce, jalapeños, beef bits.',
            price: 690,
            photo: 'fries',
          },
          {
            name: 'Chicken Pakora',
            description: 'Gram flour batter, chutney.',
            price: 490,
            photo: 'pakora',
          },
          {
            name: 'Soft Drink',
            description: '345 ml can.',
            price: 150,
            tags: ['veg'],
          },
        ],
      },
    ],
    riders: [
      { name: 'Hamza Tariq', vehicle: 'bike' },
      { name: 'Saad Mehmood', vehicle: 'bicycle' },
    ],
    deals: [
      {
        title: 'Free delivery over Rs 1,500',
        kind: 'free_delivery',
        value: 0,
        minOrder: 1500,
      },
    ],
    pastOrders: 15,
  },
  {
    key: 'rukhsana',
    name: 'Khala Rukhsana’s Kitchen',
    subType: 'home_kitchen',
    tagline:
      'Weekend pre-orders from a family kitchen · demo vendor (fictional)',
    city: 'Karachi',
    area: 'Bath Island',
    addressLine: 'House 88, Street 4 (demo)',
    lat: 24.829,
    lng: 67.039,
    phone: '0321 2459088',
    cuisines: ['home-food', 'biryani', 'desserts'],
    priceLevel: 1,
    brandColor: '#7C3AED',
    cover: 'handiBiryani',
    prepMinutes: 45,
    acceptsDelivery: true,
    acceptsPickup: true,
    codLimit: 5000,
    freeDeliveryOver: null,
    preorderOnly: true,
    hours: [5, 6, 0].map(
      (d) => [d, '11:00', '21:00'] as [number, string, string],
    ),
    bands: [{ fromKm: 0, toKm: 5, fee: 150, minOrder: 800 }],
    maxRadiusKm: 5,
    slots: [
      { weekday: 5, start: '13:00', cutoff: 720, max: 12 },
      { weekday: 6, start: '19:30', cutoff: 480, max: 10 },
      { weekday: 0, start: '13:00', cutoff: 720, max: 15 },
    ],
    groups: [],
    menu: [
      {
        name: 'Weekend specials',
        items: [
          {
            name: 'Degi Chicken Biryani',
            description: 'Cooked in a deg for the whole street, by the kilo.',
            price: 1400,
            photo: 'handiBiryani',
            tags: ['bestseller'],
            variants: [
              ['Half kilo', 1400],
              ['One kilo', 2600],
            ],
          },
          {
            name: 'Haleem',
            description: 'Slow-cooked overnight, fried onions, lemon.',
            price: 900,
            photo: 'qorma',
            serves: 2,
          },
          {
            name: 'Nihari',
            description: 'Beef shank, bone marrow, Sunday only.',
            price: 1200,
            photo: 'karahiPan',
            serves: 2,
            days: [0],
          },
          {
            name: 'Shami Kebab (dozen)',
            description: 'Frozen, ready to fry.',
            price: 1100,
          },
        ],
      },
      {
        name: 'Sweets',
        items: [
          {
            name: 'Gulab Jamun (dozen)',
            description: 'Fried to order, soaked overnight.',
            price: 900,
            photo: 'gulabJamun',
            tags: ['veg'],
          },
          {
            name: 'Shahi Kheer',
            description: 'Clay-pot kheer, pistachio.',
            price: 450,
            tags: ['veg', 'contains_nuts'],
          },
        ],
      },
    ],
    deals: [],
    pastOrders: 8,
  },
  {
    key: 'farzana',
    name: 'Farzana’s Ghar ka Khana',
    subType: 'home_kitchen',
    tagline: 'Today’s home cooking, limited portions · demo vendor (fictional)',
    city: 'Lahore',
    area: 'Garden Town',
    addressLine: 'House 210, Barkat Market side (demo)',
    lat: 31.5016,
    lng: 74.32,
    phone: '0300 4471210',
    cuisines: ['home-food', 'pakistani', 'breakfast'],
    priceLevel: 1,
    brandColor: '#15803D',
    cover: 'thali',
    prepMinutes: 30,
    acceptsDelivery: true,
    acceptsPickup: true,
    codLimit: 4000,
    freeDeliveryOver: null,
    hours: daily('08:00', '21:00'),
    // Neighbourhood delivery is free from this kitchen.
    bands: [{ fromKm: 0, toKm: 5, fee: 0, minOrder: 500 }],
    maxRadiusKm: 5,
    groups: [],
    menu: [
      {
        name: 'Breakfast',
        window: ['08:00', '11:30'],
        items: [
          {
            name: 'Aloo Paratha',
            description: 'With butter and yoghurt.',
            price: 250,
            photo: 'paratha',
            tags: ['veg'],
            portions: 20,
          },
          {
            name: 'Halwa Puri (2)',
            description: 'Chanay, suji halwa.',
            price: 380,
            tags: ['veg'],
            portions: 15,
            days: [0, 6],
          },
        ],
      },
      {
        name: 'Lunch & dinner',
        items: [
          {
            name: 'Daal Chawal',
            description: 'Yellow daal, zeera rice, achaar.',
            price: 350,
            photo: 'daal',
            tags: ['veg', 'bestseller'],
            portions: 25,
          },
          {
            name: 'Ghar ka Thali',
            description: 'Today’s salan, daal, roti, raita.',
            price: 550,
            photo: 'thali',
            portions: 15,
            serves: 1,
          },
          {
            name: 'Aloo Gosht',
            description: 'Like at home.',
            price: 520,
            photo: 'handi',
            portions: 12,
          },
          {
            name: 'Chicken Qorma',
            description: 'Mild, for the whole family.',
            price: 560,
            photo: 'qorma',
            portions: 12,
          },
          {
            name: 'Samosa (4)',
            description: 'Aloo filling, imli chutney.',
            price: 180,
            photo: 'samosa',
            tags: ['veg'],
            portions: 30,
          },
        ],
      },
    ],
    deals: [],
    pastOrders: 10,
  },
];

/** Demo customers who placed the past orders and wrote the reviews. */
export const DEMO_FOODIES = [
  {
    key: 'foodie1',
    name: 'Ayesha Khan',
    phone: '0312 4890101',
    city: 'Lahore',
    lat: 31.5204,
    lng: 74.3587,
    area: 'Gulberg II',
    line1: 'House 12, Street 4',
  },
  {
    key: 'foodie2',
    name: 'Bilal Ahmed',
    phone: '0312 4890102',
    city: 'Lahore',
    lat: 31.488,
    lng: 74.33,
    area: 'Model Town',
    line1: 'House 5, Block C',
  },
  {
    key: 'foodie3',
    name: 'Sana Iqbal',
    phone: '0312 4890103',
    city: 'Lahore',
    lat: 31.498,
    lng: 74.373,
    area: 'Cavalry Ground',
    line1: 'House 91, Street 8',
  },
  {
    key: 'foodie4',
    name: 'Omar Siddiqui',
    phone: '0333 2190104',
    city: 'Karachi',
    lat: 24.82,
    lng: 67.035,
    area: 'Clifton Block 5',
    line1: 'Flat 4B, Sea View Apartments',
  },
  {
    key: 'foodie5',
    name: 'Hira Shah',
    phone: '0333 2190105',
    city: 'Karachi',
    lat: 24.83,
    lng: 67.04,
    area: 'Bath Island',
    line1: 'House 40, Street 2',
  },
  {
    key: 'foodie6',
    name: 'Zain Malik',
    phone: '0312 4890106',
    city: 'Lahore',
    lat: 31.503,
    lng: 74.322,
    area: 'Garden Town',
    line1: 'House 18, Block K',
  },
] as const;

export const REVIEW_LINES: Array<{
  stars: number;
  text: string | null;
  tags: string[];
}> = [
  {
    stars: 5,
    text: 'Hot, fresh and exactly what we ordered.',
    tags: ['tasty', 'hot_and_fresh', 'on_time'],
  },
  {
    stars: 5,
    text: 'Generous portion — fed three of us.',
    tags: ['good_portion', 'value_for_money'],
  },
  {
    stars: 4,
    text: 'Very good, a little late on a busy night.',
    tags: ['tasty'],
  },
  { stars: 5, text: null, tags: ['tasty', 'well_packed'] },
  {
    stars: 4,
    text: 'Packed well, the rider was polite.',
    tags: ['well_packed', 'polite_rider'],
  },
  { stars: 3, text: 'Good taste but less spicy than I asked.', tags: [] },
  {
    stars: 5,
    text: 'Our Friday order every week now.',
    tags: ['tasty', 'value_for_money'],
  },
  { stars: 2, text: 'Arrived cold this time.', tags: [] },
  { stars: 4, text: null, tags: ['on_time'] },
];
