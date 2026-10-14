import {
  ALLOWED_KINDS,
  evaluateDocuments,
  REQUIRED_DOCUMENTS,
} from './required-documents';
import {
  assertTransition,
  BUSINESS_TRANSITIONS,
  canTransition,
} from './business-status';
import {
  BUSINESS_STATUSES,
  SUB_TYPES,
  SUBTYPE_SERVICE,
} from './business-types';

const doc = (kind: any, status: any = 'pending') => ({ kind, status });

describe('required documents', () => {
  it('has a rule for every sub-type', () => {
    for (const s of SUB_TYPES)
      expect(REQUIRED_DOCUMENTS[s].length).toBeGreaterThan(0);
  });

  it('doctor without PMDC is missing exactly pmdc_certificate', () => {
    const r = evaluateDocuments('doctor', [
      doc('cnic_front'),
      doc('cnic_back'),
      doc('degree_certificate'),
    ]);
    expect(r.missing).toEqual(['pmdc_certificate']);
  });

  it('store needs CNIC both sides and one of NTN or a shop photo', () => {
    expect(evaluateDocuments('store', []).missing).toEqual([
      'cnic_front',
      'cnic_back',
      'ntn_certificate|shop_photo',
    ]);
    expect(
      evaluateDocuments('store', [
        doc('cnic_front'),
        doc('cnic_back'),
        doc('shop_photo'),
      ]).missing,
    ).toEqual([]);
    expect(
      evaluateDocuments('store', [
        doc('cnic_front'),
        doc('cnic_back'),
        doc('ntn_certificate'),
      ]).missing,
    ).toEqual([]);
  });

  it('restaurant needs a storefront photo; cloud kitchen does not', () => {
    const base = [doc('cnic_front'), doc('cnic_back'), doc('pfa_licence')];
    expect(evaluateDocuments('restaurant', base).missing).toEqual([
      'storefront_photo',
    ]);
    expect(evaluateDocuments('cloud_kitchen', base).missing).toEqual([]);
    expect(ALLOWED_KINDS.cloud_kitchen).not.toContain('storefront_photo');
  });

  it('home kitchen needs two kitchen photos', () => {
    const one = [doc('cnic_front'), doc('cnic_back'), doc('kitchen_photo')];
    const r = evaluateDocuments('home_kitchen', one);
    expect(r.missing).toEqual(['kitchen_photo']);
    expect(r.requirements[2]).toEqual({
      kind: 'kitchen_photo',
      min: 2,
      have: 1,
      satisfied: false,
    });
    expect(
      evaluateDocuments('home_kitchen', [...one, doc('kitchen_photo')]).missing,
    ).toEqual([]);
  });

  it('a document an admin rejected does not count', () => {
    const r = evaluateDocuments('cloud_kitchen', [
      doc('cnic_front'),
      doc('cnic_back'),
      doc('pfa_licence', 'rejected'),
    ]);
    expect(r.missing).toEqual(['pfa_licence']);
  });

  it('sub-types map onto services as the CHECK constraint says', () => {
    expect(SUBTYPE_SERVICE).toEqual({
      store: 'shopping',
      doctor: 'healthcare',
      restaurant: 'food',
      home_kitchen: 'food',
      cloud_kitchen: 'food',
    });
  });
});

describe('business status transitions', () => {
  it('allows exactly the spec transitions', () => {
    expect(BUSINESS_TRANSITIONS).toEqual({
      draft: ['pending_approval'],
      pending_approval: ['approved', 'rejected'],
      rejected: ['pending_approval'],
      approved: ['suspended'],
      suspended: ['approved'],
    });
  });

  it('refuses everything else with 409 INVALID_TRANSITION', () => {
    for (const from of BUSINESS_STATUSES) {
      for (const to of BUSINESS_STATUSES) {
        if (canTransition(from, to)) continue;
        expect(() => assertTransition(from, to)).toThrow(
          expect.objectContaining({
            status: 409,
            response: expect.objectContaining({ code: 'INVALID_TRANSITION' }),
          }),
        );
      }
    }
    expect(canTransition('draft', 'approved')).toBe(false);
    expect(canTransition('approved', 'rejected')).toBe(false);
  });
});
