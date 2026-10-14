/**
 * THE single source of truth for which documents each kind of partner must
 * provide before they can submit for approval.
 */
import { DocumentKind, DocumentStatus, SubType } from './business-types';

export type DocumentRequirement =
  /** At least `min` (default 1) documents of this kind. */
  | { kind: DocumentKind; min?: number }
  /** At least one document of any of these kinds. */
  | { anyOf: DocumentKind[] };

export const REQUIRED_DOCUMENTS: Record<SubType, DocumentRequirement[]> = {
  store: [
    { kind: 'cnic_front' },
    { kind: 'cnic_back' },
    { anyOf: ['ntn_certificate', 'shop_photo'] },
  ],
  doctor: [
    { kind: 'cnic_front' },
    { kind: 'cnic_back' },
    { kind: 'pmdc_certificate' },
    { kind: 'degree_certificate' },
  ],
  restaurant: [
    { kind: 'cnic_front' },
    { kind: 'cnic_back' },
    { kind: 'pfa_licence' },
    { kind: 'storefront_photo' },
  ],
  cloud_kitchen: [
    { kind: 'cnic_front' },
    { kind: 'cnic_back' },
    { kind: 'pfa_licence' },
  ],
  home_kitchen: [
    { kind: 'cnic_front' },
    { kind: 'cnic_back' },
    { kind: 'kitchen_photo', min: 2 },
  ],
};

const kindsOf = (r: DocumentRequirement): DocumentKind[] =>
  'anyOf' in r ? r.anyOf : [r.kind];

/** The kinds a business of this sub-type may upload at all. */
export const ALLOWED_KINDS: Record<SubType, DocumentKind[]> =
  Object.fromEntries(
    Object.entries(REQUIRED_DOCUMENTS).map(([subType, reqs]) => [
      subType,
      [...new Set(reqs.flatMap(kindsOf))],
    ]),
  ) as Record<SubType, DocumentKind[]>;

/** How one requirement stands against the documents on file. */
export interface RequirementStatus {
  kind?: DocumentKind;
  anyOf?: DocumentKind[];
  min: number;
  have: number;
  satisfied: boolean;
}

/**
 * A requirement as it appears in `missing`: the kind, or an any-of group
 * written `a|b` (e.g. `ntn_certificate|shop_photo`).
 */
export const requirementKey = (r: DocumentRequirement): string =>
  'anyOf' in r ? r.anyOf.join('|') : r.kind;

/**
 * Evaluate a business's documents. A document an admin rejected does not
 * count — it has to be replaced.
 */
export function evaluateDocuments(
  subType: SubType,
  documents: { kind: DocumentKind; status: DocumentStatus }[],
): { requirements: RequirementStatus[]; missing: string[] } {
  const counts = new Map<DocumentKind, number>();
  for (const d of documents) {
    if (d.status === 'rejected') continue;
    counts.set(d.kind, (counts.get(d.kind) ?? 0) + 1);
  }
  const requirements = REQUIRED_DOCUMENTS[subType].map((r) => {
    const min = 'anyOf' in r ? 1 : (r.min ?? 1);
    const have = kindsOf(r).reduce((n, k) => n + (counts.get(k) ?? 0), 0);
    return {
      ...('anyOf' in r ? { anyOf: r.anyOf } : { kind: r.kind }),
      min,
      have,
      satisfied: have >= min,
    };
  });
  const missing = REQUIRED_DOCUMENTS[subType]
    .filter((_, i) => !requirements[i].satisfied)
    .map(requirementKey);
  return { requirements, missing };
}
