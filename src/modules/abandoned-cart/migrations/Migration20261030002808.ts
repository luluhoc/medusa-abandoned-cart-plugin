import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261030002808 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "abandoned_cart_notification" drop constraint if exists "abandoned_cart_notification_delivery_key_unique";`);
    this.addSql(`alter table if exists "abandoned_cart_delivery" drop constraint if exists "abandoned_cart_delivery_delivery_key_unique";`);
    this.addSql(`create table if not exists "abandoned_cart_delivery" ("id" text not null, "delivery_key" text not null, "abandoned_cart_id" text not null, "state" text not null default 'reserved', "claim_token" text not null, "claim_expires_at" timestamptz not null, "idempotency_key" text not null, "result" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "abandoned_cart_delivery_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_abandoned_cart_delivery_delivery_key_unique" ON "abandoned_cart_delivery" ("delivery_key") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_abandoned_cart_delivery_deleted_at" ON "abandoned_cart_delivery" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_abandoned_cart_delivery_abandoned_cart_id" ON "abandoned_cart_delivery" ("abandoned_cart_id") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "abandoned_cart" add column if not exists "revision" integer not null default 0, add column if not exists "attempt_order" numeric not null default 0, add column if not exists "delivery_cycle" text not null default 'initial', add column if not exists "raw_attempt_order" jsonb not null default '{"value":"0","precision":20}';`);

    this.addSql(`alter table if exists "abandoned_cart_notification" add column if not exists "delivery_key" text null;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_abandoned_cart_notification_delivery_key_unique" ON "abandoned_cart_notification" ("delivery_key") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "abandoned_cart_delivery" cascade;`);

    this.addSql(`alter table if exists "abandoned_cart" drop column if exists "revision", drop column if exists "attempt_order", drop column if exists "delivery_cycle", drop column if exists "raw_attempt_order";`);

    this.addSql(`drop index if exists "IDX_abandoned_cart_notification_delivery_key_unique";`);
    this.addSql(`alter table if exists "abandoned_cart_notification" drop column if exists "delivery_key";`);
  }

}
