import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260816104923 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "abandoned_cart" drop constraint if exists "abandoned_cart_token_unique";`);
    this.addSql(`alter table if exists "abandoned_cart" drop constraint if exists "abandoned_cart_cart_id_unique";`);
    this.addSql(`create table if not exists "abandoned_cart" ("id" text not null, "cart_id" text not null, "token" text not null, "email" text null, "customer_id" text null, "sales_channel_id" text null, "region_id" text null, "currency_code" text null, "locale" text null, "item_count" integer not null default 0, "subtotal" numeric null, "status" text check ("status" in ('pending', 'notified', 'recovered', 'converted', 'dismissed', 'expired')) not null default 'pending', "stage_index" integer not null default 0, "cart_updated_at" timestamptz not null, "last_notified_at" timestamptz null, "recovered_at" timestamptz null, "converted_at" timestamptz null, "order_id" text null, "metadata" jsonb null, "raw_subtotal" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "abandoned_cart_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_abandoned_cart_deleted_at" ON "abandoned_cart" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_abandoned_cart_cart_id_unique" ON "abandoned_cart" ("cart_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_abandoned_cart_token_unique" ON "abandoned_cart" ("token") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_abandoned_cart_status_stage_index" ON "abandoned_cart" ("status", "stage_index") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_abandoned_cart_email" ON "abandoned_cart" ("email") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_abandoned_cart_locale" ON "abandoned_cart" ("locale") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "abandoned_cart_notification" ("id" text not null, "stage_id" text not null, "stage_index" integer not null, "channel" text not null, "template" text not null, "locale" text null, "to" text not null, "notification_id" text null, "error" text null, "sent_at" timestamptz null, "abandoned_cart_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "abandoned_cart_notification_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_abandoned_cart_notification_abandoned_cart_id" ON "abandoned_cart_notification" ("abandoned_cart_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_abandoned_cart_notification_deleted_at" ON "abandoned_cart_notification" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_abandoned_cart_notification_abandoned_cart_id_stage_id" ON "abandoned_cart_notification" ("abandoned_cart_id", "stage_id") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "abandoned_cart_notification" add constraint "abandoned_cart_notification_abandoned_cart_id_foreign" foreign key ("abandoned_cart_id") references "abandoned_cart" ("id") on update cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "abandoned_cart_notification" drop constraint if exists "abandoned_cart_notification_abandoned_cart_id_foreign";`);

    this.addSql(`drop table if exists "abandoned_cart" cascade;`);

    this.addSql(`drop table if exists "abandoned_cart_notification" cascade;`);
  }

}
