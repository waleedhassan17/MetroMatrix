import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Address } from './entities/address.entity';
import { CreateAddressDto, UpdateAddressDto } from './dto/address.dto';
import { AccountService } from '../auth/account.service';
import { ErrorCode } from '../../common/errors/codes';

const MAX_ADDRESSES = 20;

export type AddressView = Omit<Address, 'user' | 'userId'>;

const view = (a: Address): AddressView => ({
  id: a.id,
  label: a.label,
  fullName: a.fullName,
  phone: a.phone,
  city: a.city,
  area: a.area,
  line1: a.line1,
  landmark: a.landmark,
  lat: a.lat,
  lng: a.lng,
  isDefault: a.isDefault,
  createdAt: a.createdAt,
  updatedAt: a.updatedAt,
});

/**
 * Saved addresses. Exactly one default per user once they have any: the first
 * address becomes it, and deleting the default promotes the newest remaining.
 */
@Injectable()
export class AddressesService implements OnModuleInit {
  constructor(
    @InjectRepository(Address)
    private readonly repo: Repository<Address>,
    private readonly dataSource: DataSource,
    private readonly account: AccountService,
  ) {}

  onModuleInit(): void {
    // Deleting an account deletes its addresses (orders keep their snapshots).
    this.account.onAccountDeleted(async (m, user) => {
      await m.delete(Address, { userId: user.id });
    });
  }

  async list(userId: string): Promise<AddressView[]> {
    const rows = await this.repo.find({
      where: { userId },
      order: { isDefault: 'DESC', createdAt: 'DESC' },
    });
    return rows.map(view);
  }

  async get(userId: string, id: string): Promise<AddressView> {
    return view(await this.mine(this.repo.manager, userId, id));
  }

  /** For other modules (checkout): the caller's address, or 404. */
  findOwned(userId: string, id: string): Promise<Address | null> {
    return this.repo.findOne({ where: { id, userId } });
  }

  async create(userId: string, dto: CreateAddressDto): Promise<AddressView> {
    return this.dataSource.transaction(async (m) => {
      const count = await m.count(Address, { where: { userId } });
      if (count >= MAX_ADDRESSES) {
        throw new BadRequestException({
          code: ErrorCode.VALIDATION_FAILED,
          message: `You can save up to ${MAX_ADDRESSES} addresses. Delete one first.`,
        });
      }
      const makeDefault = count === 0 || dto.isDefault === true;
      if (makeDefault) await this.clearDefault(m, userId);
      const saved = await m.save(
        m.create(Address, {
          userId,
          label: dto.label ?? 'home',
          fullName: dto.fullName,
          phone: dto.phone,
          city: dto.city,
          area: dto.area,
          line1: dto.line1,
          landmark: dto.landmark ?? null,
          lat: dto.lat ?? null,
          lng: dto.lng ?? null,
          isDefault: makeDefault,
        }),
      );
      return view(saved);
    });
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateAddressDto,
  ): Promise<AddressView> {
    return this.dataSource.transaction(async (m) => {
      const address = await this.mine(m, userId, id);
      if (dto.isDefault === true && !address.isDefault) {
        await this.clearDefault(m, userId);
        address.isDefault = true;
      }
      // Unsetting the only default would leave none; it moves only by setting another.
      const { isDefault: _ignored, ...fields } = dto;
      Object.assign(address, fields);
      return view(await m.save(address));
    });
  }

  async setDefault(userId: string, id: string): Promise<AddressView> {
    return this.update(userId, id, { isDefault: true });
  }

  async remove(userId: string, id: string): Promise<{ removed: true }> {
    await this.dataSource.transaction(async (m) => {
      const address = await this.mine(m, userId, id);
      await m.delete(Address, { id: address.id });
      if (address.isDefault) {
        const next = await m.findOne(Address, {
          where: { userId },
          order: { createdAt: 'DESC' },
        });
        if (next) await m.update(Address, { id: next.id }, { isDefault: true });
      }
    });
    return { removed: true };
  }

  private async mine(
    m: EntityManager,
    userId: string,
    id: string,
  ): Promise<Address> {
    const address = await m.findOne(Address, { where: { id, userId } });
    if (!address) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Address not found.',
      });
    }
    return address;
  }

  private async clearDefault(m: EntityManager, userId: string): Promise<void> {
    await m.update(Address, { userId, isDefault: true }, { isDefault: false });
  }
}
