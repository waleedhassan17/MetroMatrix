import { applyDecorators, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { Roles } from '../../../common/decorators/roles.decorator';
import { EmailVerifiedGuard } from '../../../common/guards/email-verified.guard';

/** Customer shopping routes: a signed-in customer with a verified email. */
export const ShoppingCustomer = () =>
  applyDecorators(
    ApiBearerAuth(),
    Roles('customer'),
    UseGuards(EmailVerifiedGuard),
  );
