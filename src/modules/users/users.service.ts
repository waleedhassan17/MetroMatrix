import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { ErrorCode } from '../../common/errors/codes';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly repo: Repository<User>,
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
}
