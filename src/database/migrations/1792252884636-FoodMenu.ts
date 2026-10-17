import { MigrationInterface, QueryRunner } from 'typeorm';

export class FoodMenu1792252884636 implements MigrationInterface {
  name = 'FoodMenu1792252884636';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "preorder_slots" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "branch_id" uuid NOT NULL, "weekday" smallint NOT NULL, "slot_start" TIME NOT NULL, "cutoff_minutes_before" integer NOT NULL DEFAULT '120', "max_orders" integer NOT NULL, CONSTRAINT "CHK_preorder_slots" CHECK ("weekday" BETWEEN 0 AND 6 AND "max_orders" >= 1 AND "cutoff_minutes_before" >= 0), CONSTRAINT "PK_65016af61e0b1c637ebde17351f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_043785186c0d7265f2fbb20c74" ON "preorder_slots" ("branch_id", "weekday", "slot_start") `,
    );
    await queryRunner.query(
      `CREATE TABLE "option_groups" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "brand_id" uuid NOT NULL, "name" character varying(80) NOT NULL, "min_select" smallint NOT NULL DEFAULT '0', "max_select" smallint NOT NULL DEFAULT '1', CONSTRAINT "CHK_option_groups_select" CHECK ("min_select" >= 0 AND "max_select" >= 1 AND "min_select" <= "max_select"), CONSTRAINT "PK_5078ac50f999db2431883a4dfb2" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1014f6b6f8728cfc584b6e5f8d" ON "option_groups" ("brand_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "options" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "group_id" uuid NOT NULL, "name" character varying(80) NOT NULL, "price_delta" integer NOT NULL DEFAULT '0', "is_default" boolean NOT NULL DEFAULT false, "is_active" boolean NOT NULL DEFAULT true, "sort" integer NOT NULL DEFAULT '0', CONSTRAINT "CHK_options_price" CHECK ("price_delta" >= 0), CONSTRAINT "PK_d232045bdb5c14d932fba18d957" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_72504665a029f172fec9eaa8cd" ON "options" ("group_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "menu_categories" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "brand_id" uuid NOT NULL, "name" character varying(80) NOT NULL, "sort" integer NOT NULL DEFAULT '0', "available_from" TIME, "available_to" TIME, "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_124ae987900336f983881cb04e6" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f89bd5600d8296e768cac2db64" ON "menu_categories" ("brand_id", "sort") `,
    );
    await queryRunner.query(
      `CREATE TABLE "menu_items" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "brand_id" uuid NOT NULL, "category_id" uuid NOT NULL, "name" character varying(120) NOT NULL, "description" text, "photo_url" character varying(500), "base_price" integer NOT NULL, "tags" text array NOT NULL DEFAULT '{}', "is_deal" boolean NOT NULL DEFAULT false, "serves" smallint, "days_mask" smallint NOT NULL DEFAULT '127', "is_active" boolean NOT NULL DEFAULT true, "sort" integer NOT NULL DEFAULT '0', "sold_30d" integer NOT NULL DEFAULT '0', "search" tsvector, CONSTRAINT "CHK_menu_items_numbers" CHECK ("base_price" >= 0 AND "days_mask" BETWEEN 1 AND 127 AND ("serves" IS NULL OR "serves" BETWEEN 1 AND 50)), CONSTRAINT "PK_57e6188f929e5dc6919168620c8" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d3082e29ac23f1d97e3a5b86f6" ON "menu_items" ("brand_id", "category_id", "sort") `,
    );
    await queryRunner.query(
      `CREATE TABLE "item_variants" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "item_id" uuid NOT NULL, "name" character varying(60) NOT NULL, "price" integer NOT NULL, "sort" integer NOT NULL DEFAULT '0', CONSTRAINT "CHK_item_variants_price" CHECK ("price" >= 0), CONSTRAINT "PK_d5896ae5b95e6b60d50c6bbe61e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c054ed49fdeb615fe197fbd9b6" ON "item_variants" ("item_id", "sort") `,
    );
    await queryRunner.query(
      `CREATE TABLE "item_option_groups" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "item_id" uuid NOT NULL, "group_id" uuid NOT NULL, "sort" integer NOT NULL DEFAULT '0', "variant_id" uuid, CONSTRAINT "PK_faef1c59548fd12f9aa7396a1f7" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_77b65e0d66fa4cc18939913834" ON "item_option_groups" ("group_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_966d13c933a9e6a8507e1cf61c" ON "item_option_groups" ("item_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "branch_option_overrides" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "branch_id" uuid NOT NULL, "option_id" uuid NOT NULL, "is_available" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_6c9c884beed095d876fa74ff3b3" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_2a8074b8728dad4e3d48a8c048" ON "branch_option_overrides" ("branch_id", "option_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "branch_item_overrides" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "branch_id" uuid NOT NULL, "item_id" uuid NOT NULL, "is_available" boolean NOT NULL DEFAULT true, "unavailable_until" TIMESTAMP WITH TIME ZONE, "daily_limit" integer, "remaining_today" integer, CONSTRAINT "CHK_branch_item_overrides_portions" CHECK (("daily_limit" IS NULL OR "daily_limit" >= 0) AND ("remaining_today" IS NULL OR "remaining_today" >= 0)), CONSTRAINT "PK_325b33b3c0e348c720a37dcfbfd" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_750d9f2e3a5d92fa40f9c786d7" ON "branch_item_overrides" ("branch_id", "item_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "preorder_slots" ADD CONSTRAINT "FK_2923119f6ba2b3f3ad4ef1bafe6" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "option_groups" ADD CONSTRAINT "FK_1014f6b6f8728cfc584b6e5f8d6" FOREIGN KEY ("brand_id") REFERENCES "food_brands"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "options" ADD CONSTRAINT "FK_72504665a029f172fec9eaa8cdb" FOREIGN KEY ("group_id") REFERENCES "option_groups"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "menu_categories" ADD CONSTRAINT "FK_514142cbdd9780c0ec605eadb95" FOREIGN KEY ("brand_id") REFERENCES "food_brands"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "menu_items" ADD CONSTRAINT "FK_2d2e48df4ccb4860ffbe6678076" FOREIGN KEY ("brand_id") REFERENCES "food_brands"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "menu_items" ADD CONSTRAINT "FK_20cff56c44dd4fe52d5aa2b96f8" FOREIGN KEY ("category_id") REFERENCES "menu_categories"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "item_variants" ADD CONSTRAINT "FK_db3582a34eaa7af952d12648981" FOREIGN KEY ("item_id") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "item_option_groups" ADD CONSTRAINT "FK_966d13c933a9e6a8507e1cf61c6" FOREIGN KEY ("item_id") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "item_option_groups" ADD CONSTRAINT "FK_77b65e0d66fa4cc189399138345" FOREIGN KEY ("group_id") REFERENCES "option_groups"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "item_option_groups" ADD CONSTRAINT "FK_a37261b54134fa9e175452b54cc" FOREIGN KEY ("variant_id") REFERENCES "item_variants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "branch_option_overrides" ADD CONSTRAINT "FK_898be1de0467c21ef4e34b5a46e" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "branch_option_overrides" ADD CONSTRAINT "FK_e8fddd92f647145b94c3539cb7e" FOREIGN KEY ("option_id") REFERENCES "options"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "branch_item_overrides" ADD CONSTRAINT "FK_6c2aff63fff7096922a003693c2" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "branch_item_overrides" ADD CONSTRAINT "FK_d4302cd0b3072a0370b43c53286" FOREIGN KEY ("item_id") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    // One link per (item, group, variant) — "all variants" (NULL) counted once.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_item_option_groups" ON "item_option_groups" ("item_id", "group_id", "variant_id") NULLS NOT DISTINCT`,
    );
    // Search: weighted tsvectors kept by these functions (called by the services), trigram for typos.
    await queryRunner.query(
      `CREATE INDEX "IDX_menu_items_search" ON "menu_items" USING GIN ("search")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_food_brands_search" ON "food_brands" USING GIN ("search")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_menu_items_name_trgm" ON "menu_items" USING GIN ("name" gin_trgm_ops)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_food_brands_name_trgm" ON "food_brands" USING GIN ("name" gin_trgm_ops)`,
    );
    await queryRunner.query(`
          CREATE OR REPLACE FUNCTION food_item_search_refresh(target uuid) RETURNS void
          LANGUAGE sql AS $fn$
            UPDATE menu_items i SET search =
                 setweight(to_tsvector('simple', coalesce(i.name, '')), 'A')
              || setweight(to_tsvector('english', coalesce(i.name, '')), 'A')
              || setweight(to_tsvector('simple', coalesce(array_to_string(i.tags, ' '), '')), 'B')
              || setweight(to_tsvector('english', coalesce((SELECT c.name FROM menu_categories c WHERE c.id = i.category_id), '')), 'B')
              || setweight(to_tsvector('english', coalesce(i.description, '')), 'C')
             WHERE i.id = target
          $fn$`);
    await queryRunner.query(`
          CREATE OR REPLACE FUNCTION food_brand_search_refresh(target uuid) RETURNS void
          LANGUAGE sql AS $fn$
            UPDATE food_brands b SET search =
                 setweight(to_tsvector('simple', coalesce(b.name, '')), 'A')
              || setweight(to_tsvector('english', coalesce(b.name, '')), 'A')
              || setweight(to_tsvector('english', coalesce((SELECT string_agg(c.name, ' ') FROM cuisines c WHERE c.id = ANY(b.cuisine_ids)), '')), 'B')
              || setweight(to_tsvector('english', coalesce(b.tagline, '')), 'C')
              || setweight(to_tsvector('english', coalesce((SELECT string_agg(i.name, ' ') FROM menu_items i WHERE i.brand_id = b.id AND i.is_active), '')), 'D')
             WHERE b.id = target
          $fn$`);
    await queryRunner.query(
      `SELECT food_brand_search_refresh(id) FROM food_brands`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS food_brand_search_refresh(uuid)`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS food_item_search_refresh(uuid)`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_food_brands_name_trgm"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_menu_items_name_trgm"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_food_brands_search"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_menu_items_search"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_item_option_groups"`);
    await queryRunner.query(
      `ALTER TABLE "branch_item_overrides" DROP CONSTRAINT "FK_d4302cd0b3072a0370b43c53286"`,
    );
    await queryRunner.query(
      `ALTER TABLE "branch_item_overrides" DROP CONSTRAINT "FK_6c2aff63fff7096922a003693c2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "branch_option_overrides" DROP CONSTRAINT "FK_e8fddd92f647145b94c3539cb7e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "branch_option_overrides" DROP CONSTRAINT "FK_898be1de0467c21ef4e34b5a46e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "item_option_groups" DROP CONSTRAINT "FK_a37261b54134fa9e175452b54cc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "item_option_groups" DROP CONSTRAINT "FK_77b65e0d66fa4cc189399138345"`,
    );
    await queryRunner.query(
      `ALTER TABLE "item_option_groups" DROP CONSTRAINT "FK_966d13c933a9e6a8507e1cf61c6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "item_variants" DROP CONSTRAINT "FK_db3582a34eaa7af952d12648981"`,
    );
    await queryRunner.query(
      `ALTER TABLE "menu_items" DROP CONSTRAINT "FK_20cff56c44dd4fe52d5aa2b96f8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "menu_items" DROP CONSTRAINT "FK_2d2e48df4ccb4860ffbe6678076"`,
    );
    await queryRunner.query(
      `ALTER TABLE "menu_categories" DROP CONSTRAINT "FK_514142cbdd9780c0ec605eadb95"`,
    );
    await queryRunner.query(
      `ALTER TABLE "options" DROP CONSTRAINT "FK_72504665a029f172fec9eaa8cdb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "option_groups" DROP CONSTRAINT "FK_1014f6b6f8728cfc584b6e5f8d6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "preorder_slots" DROP CONSTRAINT "FK_2923119f6ba2b3f3ad4ef1bafe6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_750d9f2e3a5d92fa40f9c786d7"`,
    );
    await queryRunner.query(`DROP TABLE "branch_item_overrides"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2a8074b8728dad4e3d48a8c048"`,
    );
    await queryRunner.query(`DROP TABLE "branch_option_overrides"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_966d13c933a9e6a8507e1cf61c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_77b65e0d66fa4cc18939913834"`,
    );
    await queryRunner.query(`DROP TABLE "item_option_groups"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c054ed49fdeb615fe197fbd9b6"`,
    );
    await queryRunner.query(`DROP TABLE "item_variants"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d3082e29ac23f1d97e3a5b86f6"`,
    );
    await queryRunner.query(`DROP TABLE "menu_items"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f89bd5600d8296e768cac2db64"`,
    );
    await queryRunner.query(`DROP TABLE "menu_categories"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_72504665a029f172fec9eaa8cd"`,
    );
    await queryRunner.query(`DROP TABLE "options"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1014f6b6f8728cfc584b6e5f8d"`,
    );
    await queryRunner.query(`DROP TABLE "option_groups"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_043785186c0d7265f2fbb20c74"`,
    );
    await queryRunner.query(`DROP TABLE "preorder_slots"`);
  }
}
