import { AdminService } from './admin.service';

/**
 * A staff decision (approve, reject, suspend, reinstate) is committed and
 * audited before the owner is emailed; the email must never hold the
 * staff member's request.
 */
describe('AdminService.notifyOwner', () => {
  const notifyOwner = (
    AdminService.prototype as unknown as {
      notifyOwner: (
        business: unknown,
        send: (to: string, name: string | null) => Promise<void>,
      ) => Promise<void>;
    }
  ).notifyOwner;

  const business = {
    owner: { email: 'owner@x.pk', displayName: 'Owner', status: 'active' },
  };

  it('answers without waiting for the email', async () => {
    const send = jest.fn(() => new Promise<void>(() => undefined));
    await expect(notifyOwner(business, send)).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledWith('owner@x.pk', 'Owner');
  });

  it('swallows a send that rejects', async () => {
    const send = jest.fn(() => Promise.reject(new Error('relay down')));
    await expect(notifyOwner(business, send)).resolves.toBeUndefined();
  });

  it('never emails a deleted owner', async () => {
    const send = jest.fn(async () => undefined);
    await notifyOwner(
      { owner: { ...business.owner, status: 'deleted' } },
      send,
    );
    expect(send).not.toHaveBeenCalled();
  });
});
