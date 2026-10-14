import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Chunk 1 P1: users, refresh-token families, the access-token denylist, the
 * operational audit trail and idempotency records.
 */

export class InitAuth1792018067283 implements MigrationInterface {
  name = 'InitAuth1792018067283';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Case-insensitive email/username/slug columns. gen_random_uuid() is
    // built into Postgres 13+, so no uuid extension is needed.
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS citext`);
    await queryRunner.query(
      `CREATE TABLE "idempotency_records" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "scope" character varying(80) NOT NULL, "idempotency_key" character varying(200) NOT NULL, "method" character varying(8) NOT NULL, "path" character varying(300) NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'pending', "status_code" integer, "response_body" jsonb, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_9ae4e93699362b0d4e3da3dd1c2" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9fffc35246eae9c6bd1de1a699" ON "idempotency_records" ("created_at") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_c16dcc0ca878b58160e527c80c" ON "idempotency_records" ("scope", "idempotency_key") `,
    );
    await queryRunner.query(
      `CREATE TABLE "operational_audit_events" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "actor_user_id" uuid, "action" character varying(64) NOT NULL, "target_type" character varying(64) NOT NULL, "target_id" character varying(64), "details" jsonb, "ip" character varying(64), "user_agent" character varying(255), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_feb1fc945b7a7c23f0741bf2b6c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f9a86e6a513dad60de2bc8deb4" ON "operational_audit_events" ("action", "created_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b046d49adfc42616949eeef996" ON "operational_audit_events" ("actor_user_id", "created_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6b133326c7924b999ef18f8779" ON "operational_audit_events" ("target_type", "target_id", "created_at") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."user_role" AS ENUM('customer', 'partner', 'rider', 'admin', 'super_admin')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."user_status" AS ENUM('active', 'disabled', 'deleted')`,
    );
    await queryRunner.query(
      `CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "email" citext NOT NULL, "password_hash" character varying(255), "display_name" character varying(80), "phone" character varying(16), "role" "public"."user_role" NOT NULL, "username" citext, "is_email_verified" boolean NOT NULL DEFAULT false, "google_sub" character varying(255), "avatar_url" character varying(500), "status" "public"."user_status" NOT NULL DEFAULT 'active', "totp_secret_enc" character varying(255), "totp_pending_secret_enc" character varying(255), "totp_enabled" boolean NOT NULL DEFAULT false, "last_login_at" TIMESTAMP WITH TIME ZONE, "token_version" integer NOT NULL DEFAULT '0', "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_97672ac88f789774dd47f7c8be" ON "users" ("email") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_fe0bb3f6520ee0469504521e71" ON "users" ("username") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_68b61ba0fb359b93b517cf1073" ON "users" ("google_sub") `,
    );
    await queryRunner.query(
      `CREATE TABLE "revoked_access_tokens" ("jti" character varying(64) NOT NULL, "user_id" uuid NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_340815421be58a8330570a1d6fb" PRIMARY KEY ("jti"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_112881f43294df4d6dc0794a17" ON "revoked_access_tokens" ("user_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_84cf475d52c4d6dccfa9d51403" ON "revoked_access_tokens" ("expires_at") `,
    );
    await queryRunner.query(
      `CREATE TABLE "refresh_tokens" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "user_id" uuid NOT NULL, "family_id" uuid NOT NULL, "token_hash" character varying(64) NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "revoked_at" TIMESTAMP WITH TIME ZONE, "replaced_by_id" uuid, "user_agent" character varying(255), "ip" character varying(64), CONSTRAINT "PK_7d8bee0204106019488c4c50ffa" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3ddc983c5f7bcf132fd8732c3f" ON "refresh_tokens" ("user_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_a7838d2ba25be1342091b6695f" ON "refresh_tokens" ("token_hash") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d5e27da0cd39bc3bb2811fc8ba" ON "refresh_tokens" ("family_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" ADD CONSTRAINT "FK_3ddc983c5f7bcf132fd8732c3f4" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" DROP CONSTRAINT "FK_3ddc983c5f7bcf132fd8732c3f4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d5e27da0cd39bc3bb2811fc8ba"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a7838d2ba25be1342091b6695f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3ddc983c5f7bcf132fd8732c3f"`,
    );
    await queryRunner.query(`DROP TABLE "refresh_tokens"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_84cf475d52c4d6dccfa9d51403"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_112881f43294df4d6dc0794a17"`,
    );
    await queryRunner.query(`DROP TABLE "revoked_access_tokens"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_68b61ba0fb359b93b517cf1073"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fe0bb3f6520ee0469504521e71"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_97672ac88f789774dd47f7c8be"`,
    );
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP TYPE "public"."user_status"`);
    await queryRunner.query(`DROP TYPE "public"."user_role"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6b133326c7924b999ef18f8779"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b046d49adfc42616949eeef996"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f9a86e6a513dad60de2bc8deb4"`,
    );
    await queryRunner.query(`DROP TABLE "operational_audit_events"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c16dcc0ca878b58160e527c80c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9fffc35246eae9c6bd1de1a699"`,
    );
    await queryRunner.query(`DROP TABLE "idempotency_records"`);
  }
}
