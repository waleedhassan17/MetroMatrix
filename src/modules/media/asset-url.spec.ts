import { ownedAssetProblem, uploadFolder } from './asset-url';

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
