import { announcementText, spellCode, AnnounceOrder } from './announce';

const order: AnnounceOrder = {
  code: 'FC-7KQ2PX',
  fulfilment: 'delivery',
  scheduledFor: null,
  paymentMethod: 'cod',
  total: 1250,
  items: [
    {
      name: 'Chicken Biryani',
      nameUr: 'چکن بریانی',
      quantity: 2,
      variant: null,
    },
    { name: 'Raita', nameUr: null, quantity: 1, variant: null },
  ],
};

describe('order announcement', () => {
  it('spells the code letter by letter', () => {
    expect(spellCode('FC-7KQ2PX')).toBe('7 K Q 2 P X');
  });

  it('Roman Urdu reads like the kitchen talks', () => {
    expect(announcementText(order, 'roman')).toBe(
      'Naya order: do Chicken Biryani, ek Raita, delivery, cash. Total 1,250 rupay. Order 7 K Q 2 P X.',
    );
  });

  it('Urdu uses Urdu names, number words and digits, falling back to the English name', () => {
    expect(announcementText(order, 'ur')).toBe(
      'نیا آرڈر: دو چکن بریانی، ایک Raita، ڈیلیوری، کیش۔ کل ۱,۲۵۰ روپے۔ آرڈر 7 K Q 2 P X۔',
    );
  });

  it('English, a pickup pre-order', () => {
    expect(
      announcementText(
        {
          ...order,
          fulfilment: 'pickup',
          scheduledFor: '2026-10-20T08:00:00Z',
          paymentMethod: 'pay_at_pickup',
        },
        'en',
      ),
    ).toBe(
      'New pre-order: two Chicken Biryani, one Raita, pickup, pay at pickup. Total 1,250 rupees. Order 7 K Q 2 P X.',
    );
  });

  it('long orders read four lines and the count of the rest; big quantities as digits', () => {
    const many = {
      ...order,
      items: Array.from({ length: 6 }, (_, i) => ({
        name: `Dish ${i}`,
        nameUr: null,
        quantity: i === 0 ? 12 : 1,
        variant: i === 0 ? 'Half' : null,
      })),
    };
    expect(announcementText(many, 'en')).toContain(
      'New order: 12 Dish 0 (Half), one Dish 1, one Dish 2, one Dish 3, and 2 more, delivery, cash.',
    );
  });
});
