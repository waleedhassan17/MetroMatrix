import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { DevicePlatform, UserDevice } from './entities/user-device.entity';
import { ErrorCode } from '../../common/errors/codes';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly repo: Repository<User>,
    @InjectRepository(UserDevice)
    private readonly devices: Repository<UserDevice>,
  ) {}

  findById(id: string): Promise<User | null> {
    return this.repo.findOne({ where: { id } });
  }

  /**
   * The live account for an address. Deleted accounts never match: their
   * email has been anonymised anyway, and the address is free to sign up
   * again.
   */
  findByEmail(email: string): Promise<User | null> {
    return this.repo.findOne({
      where: { email: email.trim().toLowerCase(), status: Not('deleted') },
    });
  }

  findByGoogleSub(sub: string): Promise<User | null> {
    return this.repo.findOne({
      where: { googleSub: sub, status: Not('deleted') },
    });
  }

  async getByIdOrFail(id: string): Promise<User> {
    const user = await this.findById(id);
    if (!user || user.status === 'deleted') {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'User not found',
      });
    }
    return user;
  }

  save(user: User): Promise<User> {
    return this.repo.save(user);
  }

  createEntity(data: Partial<User>): User {
    return this.repo.create(data);
  }

  async updateProfile(
    id: string,
    patch: { displayName?: string; phone?: string; avatarUrl?: string | null },
  ): Promise<User> {
    const user = await this.getByIdOrFail(id);
    if (patch.displayName !== undefined) user.displayName = patch.displayName;
    if (patch.phone !== undefined) user.phone = patch.phone;
    if (patch.avatarUrl !== undefined) user.avatarUrl = patch.avatarUrl;
    return this.repo.save(user);
  }

  /**
   * A push token identifies one app install, so it belongs to whichever
   * account last registered it there — signing into another account on the
   * same phone moves it.
   */
  async registerDevice(
    userId: string,
    expoPushToken: string,
    platform: DevicePlatform,
  ): Promise<{ registered: true }> {
    await this.devices
      .createQueryBuilder()
      .insert()
      .values({ userId, expoPushToken, platform, lastSeenAt: new Date() })
      .orUpdate(
        ['user_id', 'platform', 'last_seen_at', 'updated_at'],
        ['expo_push_token'],
      )
      .execute();
    return { registered: true };
  }

  async removeDevice(
    userId: string,
    expoPushToken: string,
  ): Promise<{ removed: boolean }> {
    const res = await this.devices.delete({ userId, expoPushToken });
    return { removed: (res.affected ?? 0) > 0 };
  }
}
