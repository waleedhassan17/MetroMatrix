import { applyDecorators, Type } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiProperty,
  ApiPropertyOptional,
  ApiResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import type {
  ReferenceObject,
  SchemaObject,
} from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';

/**
 * Swagger for the response envelope (CLAUDE.md): every success body is
 * `{ success: true, data }`. These describe `data` as the given DTO, a page
 * of it, or a cursor page of it — so `openapi.json` (and the web console's
 * generated types) carry real response shapes.
 */

interface EnvelopeOptions {
  status?: number;
  description?: string;
}

const envelope = (
  data: SchemaObject | ReferenceObject,
  opts: EnvelopeOptions = {},
) =>
  ApiResponse({
    status: opts.status ?? 200,
    description: opts.description ?? 'Success',
    schema: {
      type: 'object',
      required: ['success', 'data'],
      properties: {
        success: { type: 'boolean', enum: [true] },
        data,
        message: { type: 'string' },
      },
    },
  });

/** `data` is one `model`, or an array of them with `isArray`. */
export const ApiEnvelopeOk = (
  model: Type<unknown>,
  opts: EnvelopeOptions & { isArray?: boolean } = {},
) =>
  applyDecorators(
    ApiExtraModels(model),
    envelope(
      opts.isArray
        ? { type: 'array', items: { $ref: getSchemaPath(model) } }
        : { $ref: getSchemaPath(model) },
      opts,
    ),
  );

/** `data` is `{ items, total, page, pageSize }`. */
export const ApiPagedOk = (model: Type<unknown>, opts: EnvelopeOptions = {}) =>
  applyDecorators(
    ApiExtraModels(model),
    envelope(
      {
        type: 'object',
        required: ['items', 'total', 'page', 'pageSize'],
        properties: {
          items: { type: 'array', items: { $ref: getSchemaPath(model) } },
          total: { type: 'integer' },
          page: { type: 'integer' },
          pageSize: { type: 'integer' },
        },
      },
      opts,
    ),
  );

/** `data` is `{ items, nextCursor }` (newest first; null when done). */
export const ApiCursorOk = (model: Type<unknown>, opts: EnvelopeOptions = {}) =>
  applyDecorators(
    ApiExtraModels(model),
    envelope(
      {
        type: 'object',
        required: ['items', 'nextCursor'],
        properties: {
          items: { type: 'array', items: { $ref: getSchemaPath(model) } },
          nextCursor: { type: 'string', nullable: true },
        },
      },
      opts,
    ),
  );

/** `data` is a free-form object (a view not worth a class of its own). */
export const ApiObjectOk = (
  description: string,
  properties: Record<string, SchemaObject | ReferenceObject> = {},
  opts: EnvelopeOptions = {},
) =>
  envelope(
    { type: 'object', properties, additionalProperties: true },
    { ...opts, description },
  );

/** The error envelope, for the document's components. */
export class ApiErrorDetail {
  @ApiProperty({ example: 'FORBIDDEN' })
  code!: string;

  @ApiProperty()
  message!: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  details?: Record<string, unknown>;
}

export class ApiErrorBody {
  @ApiProperty({ enum: [false] })
  success!: false;

  @ApiProperty({ type: ApiErrorDetail })
  error!: ApiErrorDetail;
}

/** Simple acknowledgements: `{ changed: true }`, `{ signedOut: true }`. */
export class FlagView {
  @ApiPropertyOptional() changed?: boolean;
  @ApiPropertyOptional() signedOut?: boolean;
  @ApiPropertyOptional() deleted?: boolean;
  @ApiPropertyOptional() delivered?: boolean;
}
