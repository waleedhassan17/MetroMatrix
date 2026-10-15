import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AddressesService } from './addresses.service';
import { CreateAddressDto, UpdateAddressDto } from './dto/address.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { EmailVerifiedGuard } from '../../common/guards/email-verified.guard';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';

const uuid = new ParseUUIDPipe();

@ApiTags('addresses')
@ApiBearerAuth()
@Roles('customer')
@UseGuards(EmailVerifiedGuard)
@Controller('addresses')
export class AddressesController {
  constructor(private readonly addresses: AddressesService) {}

  @Get()
  @ApiOperation({ summary: 'Your saved addresses, default first.' })
  list(@CurrentUser() me: AuthenticatedUser) {
    return this.addresses.list(me.id);
  }

  @Post()
  @ApiOperation({
    summary: 'Save an address. The first one becomes the default.',
  })
  create(@CurrentUser() me: AuthenticatedUser, @Body() dto: CreateAddressDto) {
    return this.addresses.create(me.id, dto);
  }

  @Get(':id')
  get(@CurrentUser() me: AuthenticatedUser, @Param('id', uuid) id: string) {
    return this.addresses.get(me.id, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() me: AuthenticatedUser,
    @Param('id', uuid) id: string,
    @Body() dto: UpdateAddressDto,
  ) {
    return this.addresses.update(me.id, id, dto);
  }

  @Post(':id/default')
  @HttpCode(200)
  @ApiOperation({ summary: 'Make this the default address.' })
  setDefault(
    @CurrentUser() me: AuthenticatedUser,
    @Param('id', uuid) id: string,
  ) {
    return this.addresses.setDefault(me.id, id);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete an address. Deleting the default promotes the newest.',
  })
  remove(@CurrentUser() me: AuthenticatedUser, @Param('id', uuid) id: string) {
    return this.addresses.remove(me.id, id);
  }
}
