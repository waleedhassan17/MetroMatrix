import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { FamilyMember } from './entities/family-member.entity';
import { CreateFamilyMemberDto, UpdateFamilyMemberDto } from './dto/family.dto';
import { ErrorCode } from '../../../common/errors/codes';
import { AccountService } from '../../auth/account.service';

export const MAX_FAMILY = 8;

/** Whole years between a "YYYY-MM-DD" birthday and now. */
export function ageFrom(dob: string | null, now = new Date()): number | null {
  if (!dob) return null;
  const [y, m, d] = dob.split('-').map(Number);
  let age = now.getUTCFullYear() - y;
  if (
    now.getUTCMonth() + 1 < m ||
    (now.getUTCMonth() + 1 === m && now.getUTCDate() < d)
  )
    age -= 1;
  return Math.max(0, age);
}

export const memberView = (f: FamilyMember) => ({
  id: f.id,
  fullName: f.fullName,
  relation: f.relation,
  gender: f.gender,
  dateOfBirth: f.dateOfBirth,
  age: ageFrom(f.dateOfBirth),
  phone: f.phone,
  createdAt: f.createdAt,
});

/** The people a patient books for (max 8). */
@Injectable()
export class FamilyService implements OnModuleInit {
  constructor(
    private readonly dataSource: DataSource,
    private readonly account: AccountService,
  ) {}

  onModuleInit(): void {
    this.account.onAccountDeleted(async (m, user) => {
      await m.delete(FamilyMember, { userId: user.id });
    });
  }

  async list(userId: string) {
    const rows = await this.dataSource.manager.find(FamilyMember, {
      where: { userId },
      order: { createdAt: 'ASC' },
    });
    return rows.map(memberView);
  }

  async owned(userId: string, id: string): Promise<FamilyMember> {
    const f = await this.dataSource.manager.findOne(FamilyMember, {
      where: { id, userId },
    });
    if (!f)
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Family member not found.',
      });
    return f;
  }

  async get(userId: string, id: string) {
    return memberView(await this.owned(userId, id));
  }

  async create(userId: string, dto: CreateFamilyMemberDto) {
    return this.dataSource.transaction(async (m) => {
      const n = await m.count(FamilyMember, { where: { userId } });
      if (n >= MAX_FAMILY) {
        throw new BadRequestException({
          code: ErrorCode.VALIDATION_FAILED,
          message: `You can add up to ${MAX_FAMILY} family members.`,
        });
      }
      const saved = await m.save(
        m.create(FamilyMember, {
          userId,
          fullName: dto.fullName,
          relation: dto.relation,
          gender: dto.gender ?? null,
          dateOfBirth: dto.dateOfBirth ?? null,
          phone: dto.phone ?? null,
        }),
      );
      return memberView(saved);
    });
  }

  async update(userId: string, id: string, dto: UpdateFamilyMemberDto) {
    const f = await this.owned(userId, id);
    Object.assign(f, {
      fullName: dto.fullName ?? f.fullName,
      relation: dto.relation ?? f.relation,
      gender: dto.gender !== undefined ? dto.gender : f.gender,
      dateOfBirth:
        dto.dateOfBirth !== undefined ? dto.dateOfBirth : f.dateOfBirth,
      phone: dto.phone !== undefined ? dto.phone : f.phone,
    });
    return memberView(await this.dataSource.manager.save(f));
  }

  /** Past appointments keep their snapshot (the FK is set null). */
  async remove(userId: string, id: string) {
    await this.owned(userId, id);
    await this.dataSource.manager.delete(FamilyMember, { id, userId });
    return { removed: true };
  }
}
