import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsDefined,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  registerDecorator,
  ValidationArguments,
} from 'class-validator';
import { IsPkPhone } from '../../../common/validation/phone';
import { Trim } from '../../../common/validation/transforms';
import {
  DOCUMENT_KINDS,
  DocumentKind,
  SERVICE_TYPES,
  ServiceType,
  SUB_TYPES,
  SUBTYPE_SERVICE,
  SubType,
} from '../business-types';

/**
 * subType must belong to serviceType (store→shopping, doctor→healthcare,
 * kitchens→food). Checked here so a mismatch is a 400, not a CHECK-constraint
 * 500. Skipped when serviceType is absent (a partial update) — the service
 * checks the combination with the stored value.
 */
function SubTypeMatchesService(): PropertyDecorator {
  return (target: object, propertyName: string | symbol) =>
    registerDecorator({
      name: 'subTypeMatchesService',
      target: target.constructor,
      propertyName: propertyName as string,
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          const service = (args.object as { serviceType?: ServiceType })
            .serviceType;
          if (service === undefined || typeof value !== 'string') return true;
          return SUBTYPE_SERVICE[value as SubType] === service;
        },
        defaultMessage(args: ValidationArguments) {
          const sub = args.value as SubType;
          return `A ${sub} belongs to the ${SUBTYPE_SERVICE[sub] ?? 'other'} service`;
        },
      },
    });
}

export class CreateBusinessDto {
  @ApiProperty({ enum: SERVICE_TYPES, example: 'healthcare' })
  @IsIn([...SERVICE_TYPES])
  serviceType!: ServiceType;

  @ApiProperty({
    enum: SUB_TYPES,
    example: 'doctor',
    description:
      'store→shopping, doctor→healthcare, restaurant/home_kitchen/cloud_kitchen→food',
  })
  @IsIn([...SUB_TYPES])
  @SubTypeMatchesService()
  subType!: SubType;

  @ApiProperty({ example: 'Dr. Sana Clinic', minLength: 2, maxLength: 120 })
  @Trim()
  @IsString()
  @Length(2, 120)
  name!: string;

  @ApiProperty({
    example: '042 35761234',
    description: 'Mobile or landline; stored as +92XXXXXXXXXX.',
  })
  @IsDefined({ message: 'phone is required' })
  @IsPkPhone({ allowLandline: true })
  phone!: string;

  @ApiProperty({ example: 'Lahore', maxLength: 60 })
  @Trim()
  @IsString()
  @Length(2, 60)
  city!: string;

  @ApiProperty({ example: '12-B Main Boulevard, Gulberg III', maxLength: 255 })
  @Trim()
  @IsString()
  @Length(5, 255)
  addressLine!: string;

  @ApiPropertyOptional({ example: 31.520369 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(-90)
  @Max(90)
  lat?: number;

  @ApiPropertyOptional({ example: 74.358749 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(-180)
  @Max(180)
  lng?: number;
}

/** Only while draft or rejected; the type only while draft. */
export class UpdateBusinessDto extends PartialType(CreateBusinessDto) {}

export class AddDocumentDto {
  @ApiProperty({ enum: DOCUMENT_KINDS, example: 'cnic_front' })
  @IsIn([...DOCUMENT_KINDS])
  kind!: DocumentKind;

  @ApiProperty({
    example:
      'https://res.cloudinary.com/<cloud>/image/upload/v1712345678/metromatrix/production/<userId>/business_document/abc123.jpg',
    description:
      'The secure_url Cloudinary returned for an upload signed by /media/sign-upload.',
  })
  @IsString()
  @MaxLength(500)
  url!: string;

  @ApiProperty({
    example: 'metromatrix/production/<userId>/business_document/abc123',
    description: 'The public_id Cloudinary returned.',
  })
  @IsString()
  @MaxLength(255)
  publicId!: string;
}
