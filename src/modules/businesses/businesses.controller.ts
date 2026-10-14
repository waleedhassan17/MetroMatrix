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
import { BusinessesService } from './businesses.service';
import {
  AddDocumentDto,
  CreateBusinessDto,
  UpdateBusinessDto,
} from './dto/business.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { EmailVerifiedGuard } from '../../common/guards/email-verified.guard';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';

/**
 * Partner onboarding: create the business, upload documents, submit for
 * approval, then wait (GET /businesses/me/status). Partners only, and only
 * with a verified email.
 */
@ApiTags('businesses')
@ApiBearerAuth()
@Roles('partner')
@UseGuards(EmailVerifiedGuard)
@Controller('businesses')
export class BusinessesController {
  constructor(private readonly businesses: BusinessesService) {}

  @Post()
  @ApiOperation({
    summary:
      'Create your business (status draft). 409 BUSINESS_EXISTS if you have one.',
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateBusinessDto,
  ) {
    return this.businesses.create(user.id, dto);
  }

  @Get('me')
  @ApiOperation({
    summary:
      'Your business with its documents, requiredDocuments and missingDocuments.',
  })
  getMine(@CurrentUser() user: AuthenticatedUser) {
    return this.businesses.getMine(user.id);
  }

  @Patch('me')
  @ApiOperation({
    summary:
      'Edit while draft or rejected; 409 BUSINESS_NOT_EDITABLE otherwise.',
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateBusinessDto,
  ) {
    return this.businesses.updateMine(user.id, dto);
  }

  @Post('me/documents')
  @ApiOperation({
    summary:
      'Attach an uploaded document. The URL must be on our Cloudinary cloud, in your business_document folder.',
  })
  addDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AddDocumentDto,
  ) {
    return this.businesses.addDocument(user.id, dto);
  }

  @Delete('me/documents/:id')
  @ApiOperation({ summary: 'Remove a document (draft / rejected only).' })
  removeDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.businesses.removeDocument(user.id, id);
  }

  @Post('me/submit')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Submit for approval → pending_approval. 422 DOCUMENTS_MISSING lists what is missing.',
  })
  submit(@CurrentUser() user: AuthenticatedUser) {
    return this.businesses.submit(user.id);
  }

  @Get('me/status')
  @ApiOperation({
    summary:
      '{ status, rejectionReason, suspensionReason } — cheap, for polling.',
  })
  status(@CurrentUser() user: AuthenticatedUser) {
    return this.businesses.statusOf(user.id);
  }
}
