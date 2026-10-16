import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FamilyService } from './family.service';
import { CreateFamilyMemberDto, UpdateFamilyMemberDto } from './dto/family.dto';
import { HealthPatient } from '../common/health-roles.decorator';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../../common/decorators/current-user.decorator';

const uuid = new ParseUUIDPipe();

@ApiTags('health · patient')
@HealthPatient()
@Controller('health/family-members')
export class FamilyController {
  constructor(private readonly family: FamilyService) {}

  @Get()
  list(@CurrentUser() me: AuthenticatedUser) {
    return this.family.list(me.id);
  }

  @Post()
  create(
    @CurrentUser() me: AuthenticatedUser,
    @Body() dto: CreateFamilyMemberDto,
  ) {
    return this.family.create(me.id, dto);
  }

  @Get(':id')
  get(@CurrentUser() me: AuthenticatedUser, @Param('id', uuid) id: string) {
    return this.family.get(me.id, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() me: AuthenticatedUser,
    @Param('id', uuid) id: string,
    @Body() dto: UpdateFamilyMemberDto,
  ) {
    return this.family.update(me.id, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() me: AuthenticatedUser, @Param('id', uuid) id: string) {
    return this.family.remove(me.id, id);
  }
}
