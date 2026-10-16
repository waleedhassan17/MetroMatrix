import {
  assetParts,
  deliveryOf,
  ownedAssetProblem,
  uploadFolder,
} from './asset-url';

describe('ownedAssetProblem', () => {
  const cloudName = 'metromatrix-test';
  const folder = uploadFolder('test', 'user-1', 'business_document');
  const url = `https://res.cloudinary.com/${cloudName}/image/upload/v1712345678/${folder}/abc123.jpg`;
  const publicId = `${folder}/abc123`;

  it('accepts an upload into the caller’s own folder, with or without a version', () => {
    expect(ownedAssetProblem({ url, publicId, cloudName, folder })).toBeNull();
    expect(
      ownedAssetProblem({
        url: url.replace('v1712345678/', ''),
        publicId,
        cloudName,
        folder,
      }),
    ).toBeNull();
    expect(
      ownedAssetProblem({
        url: `https://res.cloudinary.com/${cloudName}/raw/upload/v1/${folder}/licence.pdf`,
        publicId: `${folder}/licence.pdf`,
        cloudName,
        folder,
      }),
    ).toBeNull();
  });

  it('refuses another cloud', () => {
    expect(
      ownedAssetProblem({
        url: url.replace(cloudName, 'someone-else'),
        publicId,
        cloudName,
        folder,
      }),
    ).toMatch(/isn't one of your uploads/);
  });

  it("refuses another user's folder and a sibling purpose", () => {
    const other = uploadFolder('test', 'user-2', 'business_document');
    expect(
      ownedAssetProblem({
        url: url.replace(folder, other),
        publicId: `${other}/abc123`,
        cloudName,
        folder,
      }),
    ).not.toBeNull();
    const avatar = uploadFolder('test', 'user-1', 'avatar');
    expect(
      ownedAssetProblem({
        url: url.replace(folder, avatar),
        cloudName,
        folder,
      }),
    ).not.toBeNull();
  });

  it('refuses non-https, other hosts, local paths, nested paths and query strings', () => {
    for (const bad of [
      url.replace('https:', 'http:'),
      url.replace('res.cloudinary.com', 'evil.example.com'),
      'file:///storage/emulated/0/cnic.jpg',
      `https://res.cloudinary.com/${cloudName}/image/upload/${folder}/sub/x.jpg`,
      `${url}?x=1`,
      'not a url',
    ]) {
      expect(ownedAssetProblem({ url: bad, cloudName, folder })).not.toBeNull();
    }
  });

  it('refuses a public id that is not the URL’s', () => {
    expect(
      ownedAssetProblem({
        url,
        publicId: `${folder}/other`,
        cloudName,
        folder,
      }),
    ).toMatch(/public id/);
  });
});

describe('authenticated (PHI) delivery', () => {
  const cloudName = 'metromatrix-test';
  const folder = uploadFolder('test', 'user-1', 'health_record');
  const signed = `https://res.cloudinary.com/${cloudName}/image/authenticated/s--Ab3_x-9Z--/v1712345678/${folder}/cbc.pdf`;

  it('accepts only authenticated URLs for a private purpose', () => {
    expect(deliveryOf('health_record')).toBe('authenticated');
    expect(deliveryOf('medical_note')).toBe('authenticated');
    expect(deliveryOf('avatar')).toBe('upload');
    const opts = { cloudName, folder, delivery: 'authenticated' as const };
    expect(
      ownedAssetProblem({ ...opts, url: signed, publicId: `${folder}/cbc` }),
    ).toBeNull();
    expect(
      ownedAssetProblem({
        ...opts,
        url: signed.replace('s--Ab3_x-9Z--/', ''),
      }),
    ).toBeNull();
    // A public upload of PHI is refused…
    expect(
      ownedAssetProblem({
        ...opts,
        url: `https://res.cloudinary.com/${cloudName}/image/upload/v1/${folder}/cbc.pdf`,
      }),
    ).toMatch(/isn't one of your uploads/);
    // …and a public purpose doesn't accept authenticated URLs.
    expect(ownedAssetProblem({ cloudName, folder, url: signed })).toMatch(
      /isn't one of your uploads/,
    );
  });

  it('splits a URL into what a private download is signed for', () => {
    expect(assetParts(signed)).toEqual({
      resourceType: 'image',
      publicId: `${folder}/cbc`,
      format: 'pdf',
    });
    expect(
      assetParts(
        `https://res.cloudinary.com/${cloudName}/raw/authenticated/v1/${folder}/notes.docx`,
      ),
    ).toEqual({
      resourceType: 'raw',
      publicId: `${folder}/notes.docx`,
      format: '',
    });
    expect(assetParts('not a url')).toBeNull();
  });
});
