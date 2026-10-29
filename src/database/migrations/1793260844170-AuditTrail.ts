import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Super admin, S6: the audit trail records the request id and the changed
 * fields before and after, and becomes append-only at the database level —
 * a trigger refuses every UPDATE, DELETE and TRUNCATE, so not even a bug or
 * a stolen app credential can rewrite history. (Dropping the trigger needs
 * table ownership, which is a migration, not the running app.)
 */
export class AuditTrail1793260844170 implements MigrationInterface {
  name = 'AuditTrail1793260844170';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "operational_audit_events" ADD "request_id" character varying(128)`,
    );
    await queryRunner.query(
      `ALTER TABLE "operational_audit_events" ADD "before" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "operational_audit_events" ADD "after" jsonb`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dd7e64d1b4da49936ec73bb0fc" ON "operational_audit_events" ("created_at", "id") `,
    );
    await queryRunner.query(`
          CREATE FUNCTION operational_audit_events_append_only() RETURNS trigger
          LANGUAGE plpgsql AS $$
          BEGIN
            RAISE EXCEPTION 'operational_audit_events is append-only (% refused)', TG_OP
              USING ERRCODE = 'insufficient_privilege';
          END
          $$`);
    await queryRunner.query(`
          CREATE TRIGGER "TRG_operational_audit_events_no_change"
          BEFORE UPDATE OR DELETE ON "operational_audit_events"
          FOR EACH ROW EXECUTE FUNCTION operational_audit_events_append_only()`);
    await queryRunner.query(`
          CREATE TRIGGER "TRG_operational_audit_events_no_truncate"
          BEFORE TRUNCATE ON "operational_audit_events"
          FOR EACH STATEMENT EXECUTE FUNCTION operational_audit_events_append_only()`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER "TRG_operational_audit_events_no_truncate" ON "operational_audit_events"`,
    );
    await queryRunner.query(
      `DROP TRIGGER "TRG_operational_audit_events_no_change" ON "operational_audit_events"`,
    );
    await queryRunner.query(
      `DROP FUNCTION operational_audit_events_append_only()`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_dd7e64d1b4da49936ec73bb0fc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "operational_audit_events" DROP COLUMN "after"`,
    );
    await queryRunner.query(
      `ALTER TABLE "operational_audit_events" DROP COLUMN "before"`,
    );
    await queryRunner.query(
      `ALTER TABLE "operational_audit_events" DROP COLUMN "request_id"`,
    );
  }
}
