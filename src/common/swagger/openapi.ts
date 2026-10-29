import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { ApiErrorBody } from './api-envelope';

/**
 * The OpenAPI document, built one way for both /api/docs (configureApp) and
 * `npm run openapi:export` (the committed openapi.json the web console
 * generates its types from).
 *
 * Operation ids are `<Controller>_<method>` (without the `Controller`
 * suffix): stable across runs, unique, and readable in generated clients.
 */
export function buildOpenApi(
  app: INestApplication,
  opts: { version: string; serverUrl: string },
): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('MetroMatrix API')
    .setDescription(
      'Zero-commission community marketplace: Shopping, Healthcare, Food. ' +
        'Every response is enveloped: { success, data } or { success: false, error: { code, message, details? } } (components.schemas.ApiErrorBody).',
    )
    .setVersion(opts.version)
    .addBearerAuth()
    .addServer(opts.serverUrl)
    .build();
  const doc = SwaggerModule.createDocument(app, config, {
    extraModels: [ApiErrorBody],
    operationIdFactory: (controllerKey: string, methodKey: string) =>
      `${controllerKey.replace(/Controller$/, '')}_${methodKey}`,
  });
  // One handler on two paths (an alias such as /auth/signout): keep the ids
  // unique by naming the alias after its path.
  const seen = new Set<string>();
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const op of Object.values(item) as Array<{ operationId?: string }>) {
      if (!op?.operationId) continue;
      if (seen.has(op.operationId)) {
        op.operationId = `${op.operationId}_${path.split('/').pop()}`;
      }
      seen.add(op.operationId);
    }
  }
  return doc;
}

/** Object keys sorted at every level (arrays keep their order): stable diffs. */
export function sortKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map(sortKeys) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    ) as T;
  }
  return value;
}
