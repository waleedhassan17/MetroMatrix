/**
 * The demo catalogue for `npm run seed:shopping`: four stores, 18–20
 * products each, with variants, collections, coupons and banners. Prices are
 * whole rupees. Nothing here is a secret; account numbers are format-valid
 * demo numbers that belong to no one.
 */

export type VariantSpec =
  | { kind: 'single'; stock: number }
  | {
      kind: 'sizes';
      sizes: string[];
      stock: number;
      colours?: Array<[string, string]>;
    }
  | { kind: 'options'; label1: string[]; stock: number; deltas?: number[] };

export interface DemoProduct {
  name: string;
  category: string;
  basePrice: number;
  salePrice?: number;
  tags: string[];
  description: string;
  variants: VariantSpec;
  collection?: string;
}

export interface DemoStore {
  key: 'fashion' | 'beauty' | 'home' | 'handmade';
  name: string;
  ownerName: string;
  city: string;
  addressLine: string;
  phone: string;
  tagline: string;
  about: string;
  brandColor: string;
  motif: 'stripes' | 'dots' | 'waves' | 'diamonds';
  featured: boolean;
  deliveryCities: string[];
  shippingFlatFee: number;
  freeShippingOver: number | null;
  returnWindowDays: number;
  codLimit: number;
  accounts: Array<{
    kind: 'bank' | 'jazzcash' | 'easypaisa' | 'raast';
    title: string;
    number: string;
    bankName?: string;
  }>;
  collections: string[];
  coupons: Array<{
    code: string;
    type: 'percent' | 'fixed';
    value: number;
    minOrder?: number;
    maxDiscount?: number;
  }>;
  products: DemoProduct[];
}

const S_M_L = ['S', 'M', 'L'];
const S_XL = ['S', 'M', 'L', 'XL'];
const SHOES = ['37', '38', '39', '40', '41'];
const MEN_SHOES = ['40', '41', '42', '43', '44'];

export const DEMO_STORES: DemoStore[] = [
  {
    key: 'fashion',
    name: 'Lahore Loom',
    ownerName: 'Sana Iqbal',
    city: 'Lahore',
    addressLine: '14 Liberty Market, Gulberg III',
    phone: '03214567801',
    tagline: 'Hand-finished lawn, khaddar and kurtas',
    about:
      'A family workshop in Gulberg making ready-to-wear eastern clothing since 2009. Every piece is cut and finished in Lahore.',
    brandColor: '#7F1D1D',
    motif: 'stripes',
    featured: true,
    deliveryCities: [],
    shippingFlatFee: 200,
    freeShippingOver: 5000,
    returnWindowDays: 7,
    codLimit: 15000,
    accounts: [
      {
        kind: 'bank',
        title: 'Lahore Loom',
        number: 'MEZN:0101234567890011',
        bankName: 'Meezan Bank',
      },
      { kind: 'jazzcash', title: 'Sana Iqbal', number: '03214567801' },
    ],
    collections: ['Eid edit', 'Winter khaddar'],
    coupons: [
      { code: 'LOOM10', type: 'percent', value: 10, maxDiscount: 800 },
      { code: 'EID500', type: 'fixed', value: 500, minOrder: 4000 },
    ],
    products: [
      {
        name: 'Embroidered lawn kurta',
        category: 'women-kurtas-tunics',
        basePrice: 4500,
        salePrice: 3900,
        tags: ['lawn', 'eid', 'embroidered'],
        description:
          'Three-quarter sleeves, chikankari neckline, soft summer lawn.',
        variants: {
          kind: 'sizes',
          sizes: S_XL,
          stock: 6,
          colours: [
            ['Maroon', '#7F1D1D'],
            ['Teal', '#0F766E'],
          ],
        },
        collection: 'Eid edit',
      },
      {
        name: 'Printed lawn three-piece',
        category: 'women-shalwar-kameez',
        basePrice: 6200,
        tags: ['lawn', 'printed', 'three-piece'],
        description:
          'Shirt, trouser and chiffon dupatta in a digital floral print.',
        variants: { kind: 'sizes', sizes: S_M_L, stock: 5 },
        collection: 'Eid edit',
      },
      {
        name: 'Chiffon dupatta',
        category: 'women-dupattas-shawls',
        basePrice: 1800,
        tags: ['chiffon', 'dupatta'],
        description: 'Lightweight chiffon with a hand-rolled edge.',
        variants: {
          kind: 'options',
          label1: ['Blush', 'Mint', 'Ivory'],
          stock: 12,
        },
      },
      {
        name: 'Khaddar shawl',
        category: 'women-dupattas-shawls',
        basePrice: 3200,
        salePrice: 2700,
        tags: ['khaddar', 'winter', 'shawl'],
        description: 'Hand-loomed khaddar, warm without weight.',
        variants: { kind: 'options', label1: ['Rust', 'Charcoal'], stock: 8 },
        collection: 'Winter khaddar',
      },
      {
        name: 'Cotton straight kurta',
        category: 'women-kurtas-tunics',
        basePrice: 2900,
        tags: ['cotton', 'everyday'],
        description: 'Everyday cotton with side slits and pockets.',
        variants: { kind: 'sizes', sizes: S_XL, stock: 9 },
      },
      {
        name: 'Silk festive kurta',
        category: 'women-kurtas-tunics',
        basePrice: 8900,
        salePrice: 7500,
        tags: ['silk', 'festive', 'eid'],
        description: 'Raw silk with gota work on the yoke.',
        variants: { kind: 'sizes', sizes: S_M_L, stock: 3 },
        collection: 'Eid edit',
      },
      {
        name: 'Wide-leg trousers',
        category: 'women-western-wear',
        basePrice: 2400,
        tags: ['trousers', 'cotton'],
        description: 'High-rise wide-leg trousers in cotton twill.',
        variants: {
          kind: 'sizes',
          sizes: S_XL,
          stock: 10,
          colours: [
            ['Black', '#111111'],
            ['Beige', '#D6C7A1'],
          ],
        },
      },
      {
        name: 'Embellished khussa',
        category: 'women-footwear',
        basePrice: 3500,
        tags: ['khussa', 'footwear', 'eid'],
        description: 'Leather khussa with tilla embroidery.',
        variants: { kind: 'sizes', sizes: SHOES, stock: 4 },
        collection: 'Eid edit',
      },
      {
        name: 'Block-print kameez',
        category: 'women-shalwar-kameez',
        basePrice: 4100,
        tags: ['block-print', 'cotton'],
        description: 'Hand block-printed cotton with a straight cut.',
        variants: { kind: 'sizes', sizes: S_M_L, stock: 7 },
      },
      {
        name: 'Velvet shawl',
        category: 'women-dupattas-shawls',
        basePrice: 5600,
        tags: ['velvet', 'winter', 'shawl'],
        description: 'Micro-velvet with a scalloped border.',
        variants: { kind: 'options', label1: ['Emerald', 'Plum'], stock: 4 },
        collection: 'Winter khaddar',
      },
      {
        name: "Men's cotton kurta",
        category: 'men-kurtas-shalwar-kameez',
        basePrice: 3800,
        tags: ['cotton', 'men', 'kurta'],
        description: 'Classic band collar, breathable cotton.',
        variants: {
          kind: 'sizes',
          sizes: S_XL,
          stock: 8,
          colours: [
            ['White', '#F5F5F5'],
            ['Sky', '#7DD3FC'],
          ],
        },
      },
      {
        name: 'Wash-and-wear shalwar kameez',
        category: 'men-kurtas-shalwar-kameez',
        basePrice: 4600,
        salePrice: 4200,
        tags: ['wash-and-wear', 'men'],
        description: 'Crease-resistant fabric for everyday wear.',
        variants: { kind: 'sizes', sizes: S_XL, stock: 6 },
      },
      {
        name: 'Jamawar waistcoat',
        category: 'men-waistcoats',
        basePrice: 6500,
        tags: ['waistcoat', 'jamawar', 'wedding'],
        description: 'Jamawar weave with a satin lining.',
        variants: { kind: 'sizes', sizes: S_XL, stock: 4 },
        collection: 'Eid edit',
      },
      {
        name: 'Khaddar waistcoat',
        category: 'men-waistcoats',
        basePrice: 4200,
        tags: ['waistcoat', 'khaddar', 'winter'],
        description: 'Hand-loomed khaddar, five buttons.',
        variants: { kind: 'sizes', sizes: S_XL, stock: 5 },
        collection: 'Winter khaddar',
      },
      {
        name: 'Peshawari chappal',
        category: 'men-footwear',
        basePrice: 4800,
        tags: ['chappal', 'leather', 'footwear'],
        description: 'Hand-stitched leather with a cushioned sole.',
        variants: { kind: 'sizes', sizes: MEN_SHOES, stock: 3 },
      },
      {
        name: 'Linen shirt',
        category: 'men-shirts-tshirts',
        basePrice: 3300,
        tags: ['linen', 'shirt'],
        description: 'Relaxed-fit linen with a grandad collar.',
        variants: { kind: 'sizes', sizes: S_XL, stock: 7 },
      },
      {
        name: 'Chikankari dupatta',
        category: 'women-dupattas-shawls',
        basePrice: 2600,
        tags: ['chikankari', 'dupatta', 'eid'],
        description: 'White-on-white chikankari on cotton voile.',
        variants: { kind: 'single', stock: 10 },
      },
      {
        name: 'Kids lawn frock',
        category: 'kids-girls',
        basePrice: 2200,
        salePrice: 1900,
        tags: ['kids', 'lawn', 'frock'],
        description: 'Twirl-ready lawn frock with a lined bodice.',
        variants: {
          kind: 'options',
          label1: ['2-3Y', '4-5Y', '6-7Y'],
          stock: 6,
        },
      },
    ],
  },
  {
    key: 'beauty',
    name: 'Glow Theory',
    ownerName: 'Hira Malik',
    city: 'Karachi',
    addressLine: 'Shop 6, Bukhari Commercial, DHA Phase 6',
    phone: '03331234590',
    tagline: 'Small-batch skincare made in Karachi',
    about:
      'Gentle formulas, short ingredient lists, and honest labels. Everything is batch-dated.',
    brandColor: '#6D28D9',
    motif: 'dots',
    featured: false,
    deliveryCities: [],
    shippingFlatFee: 150,
    freeShippingOver: 3000,
    returnWindowDays: 3,
    codLimit: 8000,
    accounts: [
      { kind: 'easypaisa', title: 'Hira Malik', number: '03331234590' },
      { kind: 'raast', title: 'Glow Theory', number: '03001112223' },
    ],
    collections: ['Bestsellers', 'Summer skin'],
    coupons: [
      { code: 'GLOW15', type: 'percent', value: 15, maxDiscount: 600 },
      { code: 'FIRST200', type: 'fixed', value: 200, minOrder: 1500 },
    ],
    products: [
      {
        name: 'Vitamin C serum',
        category: 'beauty-skincare',
        basePrice: 2400,
        salePrice: 1990,
        tags: ['serum', 'vitamin-c', 'brightening'],
        description: '10% ascorbyl glucoside in a light gel.',
        variants: {
          kind: 'options',
          label1: ['15 ml', '30 ml'],
          stock: 15,
          deltas: [0, 1100],
        },
        collection: 'Bestsellers',
      },
      {
        name: 'Niacinamide toner',
        category: 'beauty-skincare',
        basePrice: 1600,
        tags: ['toner', 'niacinamide'],
        description: '5% niacinamide with rose water.',
        variants: { kind: 'single', stock: 20 },
        collection: 'Bestsellers',
      },
      {
        name: 'Aloe gel moisturiser',
        category: 'beauty-skincare',
        basePrice: 1200,
        tags: ['moisturiser', 'aloe', 'summer'],
        description: 'Oil-free aloe gel for humid days.',
        variants: { kind: 'single', stock: 25 },
        collection: 'Summer skin',
      },
      {
        name: 'Mineral sunscreen SPF 50',
        category: 'beauty-skincare',
        basePrice: 2100,
        tags: ['sunscreen', 'spf', 'summer'],
        description: 'Zinc oxide, no white cast on medium skin.',
        variants: { kind: 'single', stock: 18 },
        collection: 'Summer skin',
      },
      {
        name: 'Charcoal face wash',
        category: 'beauty-skincare',
        basePrice: 950,
        tags: ['face-wash', 'charcoal'],
        description: 'Deep-cleansing gel for oily skin.',
        variants: { kind: 'single', stock: 30 },
      },
      {
        name: 'Matte lipstick',
        category: 'beauty-makeup',
        basePrice: 1450,
        tags: ['lipstick', 'matte'],
        description: 'Long-wear matte, enriched with shea.',
        variants: {
          kind: 'options',
          label1: ['Brick', 'Rose', 'Berry', 'Nude'],
          stock: 9,
        },
        collection: 'Bestsellers',
      },
      {
        name: 'Kohl kajal pencil',
        category: 'beauty-makeup',
        basePrice: 650,
        tags: ['kajal', 'kohl', 'eyes'],
        description: 'Smudge-proof, ophthalmologist tested.',
        variants: { kind: 'single', stock: 40 },
      },
      {
        name: 'Tinted lip balm',
        category: 'beauty-makeup',
        basePrice: 550,
        salePrice: 450,
        tags: ['lip-balm', 'tinted'],
        description: 'Beeswax balm with a sheer tint.',
        variants: { kind: 'options', label1: ['Peach', 'Cherry'], stock: 22 },
      },
      {
        name: 'Rosemary hair oil',
        category: 'beauty-hair-care',
        basePrice: 1350,
        tags: ['hair-oil', 'rosemary'],
        description: 'Cold-pressed oils with rosemary extract.',
        variants: {
          kind: 'options',
          label1: ['100 ml', '200 ml'],
          stock: 16,
          deltas: [0, 900],
        },
        collection: 'Bestsellers',
      },
      {
        name: 'Sulphate-free shampoo',
        category: 'beauty-hair-care',
        basePrice: 1700,
        tags: ['shampoo', 'sulphate-free'],
        description: 'Mild cleanser for coloured hair.',
        variants: { kind: 'single', stock: 14 },
      },
      {
        name: 'Argan hair mask',
        category: 'beauty-hair-care',
        basePrice: 1900,
        tags: ['hair-mask', 'argan'],
        description: 'Weekly deep conditioner.',
        variants: { kind: 'single', stock: 8 },
      },
      {
        name: 'Oud attar',
        category: 'beauty-fragrance',
        basePrice: 3200,
        tags: ['attar', 'oud', 'fragrance'],
        description: 'Alcohol-free attar, roll-on.',
        variants: {
          kind: 'options',
          label1: ['6 ml', '12 ml'],
          stock: 6,
          deltas: [0, 2400],
        },
      },
      {
        name: 'Jasmine body mist',
        category: 'beauty-fragrance',
        basePrice: 1500,
        tags: ['body-mist', 'jasmine', 'summer'],
        description: 'Fresh motia notes.',
        variants: { kind: 'single', stock: 12 },
        collection: 'Summer skin',
      },
      {
        name: 'Ubtan face pack',
        category: 'beauty-skincare',
        basePrice: 1100,
        tags: ['ubtan', 'face-pack', 'bridal'],
        description: 'Traditional gram flour, turmeric and sandalwood blend.',
        variants: { kind: 'single', stock: 20 },
      },
      {
        name: 'Hand cream trio',
        category: 'beauty-personal-care',
        basePrice: 1800,
        salePrice: 1500,
        tags: ['hand-cream', 'gift'],
        description: 'Shea, rose and lemongrass in travel tubes.',
        variants: { kind: 'single', stock: 10 },
      },
      {
        name: 'Bamboo toothbrush set',
        category: 'beauty-personal-care',
        basePrice: 700,
        tags: ['toothbrush', 'bamboo'],
        description: 'Four soft-bristle brushes.',
        variants: { kind: 'single', stock: 35 },
      },
      {
        name: 'Exfoliating sugar scrub',
        category: 'beauty-personal-care',
        basePrice: 1250,
        tags: ['scrub', 'body'],
        description: 'Brown sugar and coconut oil.',
        variants: { kind: 'options', label1: ['Coffee', 'Vanilla'], stock: 11 },
      },
      {
        name: 'Makeup brush kit',
        category: 'beauty-makeup',
        basePrice: 2800,
        tags: ['brushes', 'makeup'],
        description: 'Seven synthetic brushes in a canvas roll.',
        variants: { kind: 'single', stock: 2 },
      },
    ],
  },
  {
    key: 'home',
    name: 'Ghar Ghar Home',
    ownerName: 'Usman Tariq',
    city: 'Islamabad',
    addressLine: 'Plot 22, I-10 Markaz',
    phone: '03125556677',
    tagline: 'Bedding, kitchen and decor for real homes',
    about:
      'Practical, good-looking things for Pakistani homes, sourced from local mills and workshops.',
    brandColor: '#0F766E',
    motif: 'waves',
    featured: false,
    deliveryCities: ['Islamabad', 'Rawalpindi', 'Lahore', 'Karachi'],
    shippingFlatFee: 300,
    freeShippingOver: 8000,
    returnWindowDays: 10,
    codLimit: 20000,
    accounts: [
      {
        kind: 'bank',
        title: 'Ghar Ghar Home',
        number: 'HABB:0011223344556677',
        bankName: 'HBL',
      },
    ],
    collections: ['Kitchen essentials', 'Bedroom refresh'],
    coupons: [
      { code: 'HOME5', type: 'percent', value: 5 },
      { code: 'GHAR1000', type: 'fixed', value: 1000, minOrder: 10000 },
    ],
    products: [
      {
        name: 'Percale bedsheet set',
        category: 'home-bedding',
        basePrice: 5500,
        salePrice: 4700,
        tags: ['bedsheet', 'cotton', 'percale'],
        description: '200 thread-count cotton percale, two pillow covers.',
        variants: {
          kind: 'options',
          label1: ['Single', 'Double', 'King'],
          stock: 7,
          deltas: [-1500, 0, 1500],
        },
        collection: 'Bedroom refresh',
      },
      {
        name: 'Quilted razai',
        category: 'home-bedding',
        basePrice: 8500,
        tags: ['razai', 'winter', 'quilt'],
        description: 'Hand-quilted cotton fill.',
        variants: {
          kind: 'options',
          label1: ['Single', 'Double'],
          stock: 4,
          deltas: [0, 2500],
        },
        collection: 'Bedroom refresh',
      },
      {
        name: 'Cushion cover pair',
        category: 'home-decor',
        basePrice: 1600,
        tags: ['cushion', 'decor'],
        description: '16-inch covers in slub cotton.',
        variants: {
          kind: 'options',
          label1: ['Mustard', 'Indigo', 'Sage'],
          stock: 14,
        },
      },
      {
        name: 'Cast-iron karahi',
        category: 'home-kitchen-dining',
        basePrice: 4200,
        tags: ['karahi', 'cast-iron', 'cookware'],
        description: 'Pre-seasoned, 10-inch, with wooden handles.',
        variants: { kind: 'single', stock: 6 },
        collection: 'Kitchen essentials',
      },
      {
        name: 'Steel tiffin carrier',
        category: 'home-kitchen-dining',
        basePrice: 2300,
        tags: ['tiffin', 'steel', 'lunch'],
        description: 'Three-tier stainless steel.',
        variants: { kind: 'single', stock: 12 },
        collection: 'Kitchen essentials',
      },
      {
        name: 'Ceramic dinner set',
        category: 'home-kitchen-dining',
        basePrice: 12500,
        salePrice: 10900,
        tags: ['dinner-set', 'ceramic'],
        description: '24 pieces for six, microwave safe.',
        variants: { kind: 'single', stock: 3 },
        collection: 'Kitchen essentials',
      },
      {
        name: 'Masala dabba',
        category: 'home-kitchen-dining',
        basePrice: 2700,
        tags: ['spice-box', 'steel'],
        description: 'Seven-cup spice box with a glass lid.',
        variants: { kind: 'single', stock: 9 },
        collection: 'Kitchen essentials',
      },
      {
        name: 'Jute floor rug',
        category: 'home-decor',
        basePrice: 6800,
        tags: ['rug', 'jute'],
        description: 'Hand-braided jute, 4 × 6 ft.',
        variants: { kind: 'single', stock: 5 },
      },
      {
        name: 'Brass table lamp',
        category: 'home-decor',
        basePrice: 7400,
        tags: ['lamp', 'brass', 'lighting'],
        description: 'Antique-finish brass with a linen shade.',
        variants: { kind: 'single', stock: 4 },
      },
      {
        name: 'Turkish bath towel',
        category: 'home-bath',
        basePrice: 1900,
        tags: ['towel', 'cotton', 'bath'],
        description: 'Flat-woven peshtemal, quick-drying.',
        variants: {
          kind: 'options',
          label1: ['Navy', 'Terracotta', 'Grey'],
          stock: 15,
        },
      },
      {
        name: 'Bath mat',
        category: 'home-bath',
        basePrice: 1200,
        tags: ['bath-mat'],
        description: 'Tufted cotton, anti-slip back.',
        variants: { kind: 'single', stock: 18 },
      },
      {
        name: 'Woven storage basket',
        category: 'home-storage',
        basePrice: 2100,
        tags: ['basket', 'storage'],
        description: 'Seagrass basket with handles.',
        variants: {
          kind: 'options',
          label1: ['Small', 'Large'],
          stock: 10,
          deltas: [0, 800],
        },
      },
      {
        name: 'Wall shelf set',
        category: 'home-storage',
        basePrice: 3900,
        tags: ['shelf', 'wood'],
        description: 'Two floating shelves in sheesham.',
        variants: { kind: 'single', stock: 6 },
      },
      {
        name: 'Blackout curtains',
        category: 'home-decor',
        basePrice: 4600,
        salePrice: 3990,
        tags: ['curtains', 'blackout'],
        description: 'Pair of 7-ft panels with eyelets.',
        variants: { kind: 'options', label1: ['Charcoal', 'Ivory'], stock: 8 },
        collection: 'Bedroom refresh',
      },
      {
        name: 'Glass water jug',
        category: 'home-kitchen-dining',
        basePrice: 1100,
        tags: ['jug', 'glass'],
        description: '1.5 litre with a bamboo lid.',
        variants: { kind: 'single', stock: 20 },
      },
      {
        name: 'Memory foam pillow',
        category: 'home-bedding',
        basePrice: 3400,
        tags: ['pillow', 'memory-foam'],
        description: 'Contoured support, washable cover.',
        variants: { kind: 'single', stock: 9 },
        collection: 'Bedroom refresh',
      },
      {
        name: 'Wooden chopping board',
        category: 'home-kitchen-dining',
        basePrice: 1500,
        tags: ['chopping-board', 'wood'],
        description: 'Single-piece sheesham board.',
        variants: { kind: 'single', stock: 1 },
      },
      {
        name: 'Scented candle',
        category: 'home-decor',
        basePrice: 1300,
        tags: ['candle', 'gift'],
        description: 'Soy wax, oud and amber.',
        variants: { kind: 'single', stock: 13 },
      },
    ],
  },
  {
    key: 'handmade',
    name: 'Haath Kaari',
    ownerName: 'Ayesha Noor',
    city: 'Multan',
    addressLine: 'Hussain Agahi Bazaar, Shop 41',
    phone: '03017778899',
    tagline: 'Craft from Multan, Hala and Swat',
    about:
      'We work directly with artisan families and pay them before we sell. Every piece is one of a few.',
    brandColor: '#B45309',
    motif: 'diamonds',
    featured: true,
    deliveryCities: [],
    shippingFlatFee: 250,
    freeShippingOver: 6000,
    returnWindowDays: 7,
    codLimit: 10000,
    accounts: [
      {
        kind: 'bank',
        title: 'Haath Kaari',
        number: 'UNIL:0090087766554433',
        bankName: 'UBL',
      },
      { kind: 'jazzcash', title: 'Ayesha Noor', number: '03017778899' },
    ],
    collections: ['Blue pottery', 'Truck art'],
    coupons: [
      { code: 'CRAFT10', type: 'percent', value: 10, maxDiscount: 1000 },
      { code: 'HAATH250', type: 'fixed', value: 250, minOrder: 2500 },
    ],
    products: [
      {
        name: 'Multani blue pottery vase',
        category: 'handmade-pottery-ceramics',
        basePrice: 3800,
        tags: ['blue-pottery', 'vase', 'multan'],
        description: 'Hand-painted kashi work, 12 inches.',
        variants: { kind: 'single', stock: 4 },
        collection: 'Blue pottery',
      },
      {
        name: 'Blue pottery mug',
        category: 'handmade-pottery-ceramics',
        basePrice: 1200,
        salePrice: 990,
        tags: ['blue-pottery', 'mug'],
        description: 'Glazed kashi mug, holds 300 ml.',
        variants: {
          kind: 'options',
          label1: ['Floral', 'Geometric'],
          stock: 10,
        },
        collection: 'Blue pottery',
      },
      {
        name: 'Blue pottery serving bowl',
        category: 'handmade-pottery-ceramics',
        basePrice: 2600,
        tags: ['blue-pottery', 'bowl'],
        description: 'Food-safe glaze, 9-inch bowl.',
        variants: { kind: 'single', stock: 6 },
        collection: 'Blue pottery',
      },
      {
        name: 'Truck art kettle',
        category: 'handmade-truck-art',
        basePrice: 3500,
        tags: ['truck-art', 'kettle', 'decor'],
        description: 'Hand-painted steel kettle — decorative.',
        variants: { kind: 'single', stock: 5 },
        collection: 'Truck art',
      },
      {
        name: 'Truck art tray',
        category: 'handmade-truck-art',
        basePrice: 2200,
        tags: ['truck-art', 'tray'],
        description: 'Painted tin tray with a lacquer finish.',
        variants: { kind: 'single', stock: 8 },
        collection: 'Truck art',
      },
      {
        name: 'Truck art wall plate',
        category: 'handmade-truck-art',
        basePrice: 1800,
        tags: ['truck-art', 'wall-decor'],
        description: 'Peacock motif, ready to hang.',
        variants: { kind: 'options', label1: ['Peacock', 'Rose'], stock: 7 },
        collection: 'Truck art',
      },
      {
        name: 'Ajrak shawl',
        category: 'handmade-handwoven-textiles',
        basePrice: 4200,
        tags: ['ajrak', 'sindh', 'shawl'],
        description: 'Hand block-printed in Hala with natural dyes.',
        variants: { kind: 'single', stock: 6 },
      },
      {
        name: 'Swati embroidered cushion',
        category: 'handmade-embroidery',
        basePrice: 2900,
        tags: ['swati', 'embroidery', 'cushion'],
        description: 'Phulkari-style silk embroidery from Swat.',
        variants: { kind: 'single', stock: 5 },
      },
      {
        name: 'Sindhi rilli quilt',
        category: 'handmade-handwoven-textiles',
        basePrice: 9500,
        tags: ['rilli', 'quilt', 'sindh'],
        description: 'Appliqué patchwork, double size.',
        variants: { kind: 'single', stock: 2 },
      },
      {
        name: 'Camel skin lamp',
        category: 'handmade-woodwork',
        basePrice: 6800,
        salePrice: 5900,
        tags: ['camel-skin', 'lamp', 'multan'],
        description: 'Naqashi painting on cured camel skin.',
        variants: { kind: 'single', stock: 3 },
      },
      {
        name: 'Walnut wood jewellery box',
        category: 'handmade-woodwork',
        basePrice: 4500,
        tags: ['walnut', 'jewellery-box', 'swat'],
        description: 'Carved walnut from Swat, velvet lined.',
        variants: { kind: 'single', stock: 4 },
      },
      {
        name: 'Chinioti carved coaster set',
        category: 'handmade-woodwork',
        basePrice: 1600,
        tags: ['chiniot', 'coasters', 'wood'],
        description: 'Six coasters in sheesham.',
        variants: { kind: 'single', stock: 12 },
      },
      {
        name: 'Hand-woven khes',
        category: 'handmade-handwoven-textiles',
        basePrice: 3600,
        tags: ['khes', 'cotton', 'handwoven'],
        description: 'Double-cloth cotton khes from Kamalia.',
        variants: {
          kind: 'options',
          label1: ['Red check', 'Blue check'],
          stock: 6,
        },
      },
      {
        name: 'Tilla embroidered clutch',
        category: 'accessories-bags',
        basePrice: 2500,
        tags: ['clutch', 'tilla', 'embroidery'],
        description: 'Gold tilla on velvet with a chain strap.',
        variants: { kind: 'options', label1: ['Black', 'Maroon'], stock: 5 },
      },
      {
        name: 'Clay diya set',
        category: 'handmade-pottery-ceramics',
        basePrice: 800,
        tags: ['diya', 'clay'],
        description: 'Twelve hand-thrown clay lamps.',
        variants: { kind: 'single', stock: 25 },
      },
      {
        name: 'Lacquered rolling pin',
        category: 'handmade-woodwork',
        basePrice: 650,
        tags: ['lacquer', 'kitchen', 'wood'],
        description: 'Traditional jandi lacquer stripes.',
        variants: { kind: 'single', stock: 18 },
      },
      {
        name: 'Silver jhumka earrings',
        category: 'accessories-jewellery',
        basePrice: 3900,
        tags: ['jhumka', 'silver', 'jewellery'],
        description: 'Oxidised silver, handmade in Peshawar.',
        variants: { kind: 'single', stock: 3 },
      },
      {
        name: 'Embroidered table runner',
        category: 'handmade-embroidery',
        basePrice: 2300,
        tags: ['table-runner', 'embroidery'],
        description: 'Mirror-work runner, 6 feet.',
        variants: { kind: 'single', stock: 0 },
      },
    ],
  },
];

/** Three home-screen banners; targets are resolved by key at seed time. */
export const DEMO_BANNERS = [
  {
    title: 'The Eid edit is here',
    subtitle: 'Lawn, silk and khussas from Lahore Loom',
    target: { type: 'collection', store: 'fashion', collection: 'Eid edit' },
  },
  {
    title: 'Craft from Multan to Swat',
    subtitle: 'Blue pottery, truck art and more at Haath Kaari',
    target: { type: 'store', store: 'handmade' },
  },
  {
    title: 'Summer skin, sorted',
    subtitle: 'Sunscreen and light moisturisers',
    target: { type: 'category', category: 'beauty' },
  },
] as const;
