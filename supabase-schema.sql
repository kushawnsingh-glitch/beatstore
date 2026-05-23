-- ================================================================
-- Birdie Bands — Supabase Schema
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ================================================================

-- ── Tables ──────────────────────────────────────────────────────

create table if not exists beats (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  artist        text not null,
  bpm           integer,
  key           text,
  duration      text,
  tags          text[] default '{}',
  available     boolean default true,
  s3_mp3_url    text,
  s3_image_url  text,
  licenses      jsonb default '[]',
  youtube_url   text,
  type          text default 'Beat',
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create table if not exists packs (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  description   text,
  tags          text[] default '{}',
  available     boolean default true,
  price         numeric default 0,
  s3_mp3_url    text,
  s3_image_url  text,
  s3_file_url   text,
  licenses      jsonb default '[]',
  created_at    timestamptz default now()
);

create table if not exists beat_packs (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  description   text,
  tags          text[] default '{}',
  available     boolean default true,
  price         numeric default 0,
  s3_mp3_url    text,
  s3_image_url  text,
  s3_file_url   text,
  licenses      jsonb default '[]',
  created_at    timestamptz default now()
);

create table if not exists licenses (
  id                    uuid primary key default gen_random_uuid(),
  type                  text,
  title                 text,
  description           text,
  features              text[] default '{}',
  license_download_link text,
  license_contract      text,
  created_at            timestamptz default now()
);

create table if not exists customers (
  id         uuid primary key default gen_random_uuid(),
  name       text,
  email      text unique,
  address    text,
  city       text,
  state      text,
  zip        text,
  country    text,
  created_at timestamptz default now()
);

create table if not exists orders (
  id                        uuid primary key default gen_random_uuid(),
  order_id                  text unique not null,
  payment_type              text,
  stripe_payment_intent_id  text,
  paypal_order_id           text,
  customer_info             jsonb,
  items                     jsonb default '[]',
  total_price               numeric,
  created_at                timestamptz default now()
);

create table if not exists coupons (
  id               uuid primary key default gen_random_uuid(),
  code             text unique not null,
  discount_type    text,
  discount_value   numeric,
  is_active        boolean default true,
  valid_from       timestamptz,
  valid_until      timestamptz,
  max_uses         integer,
  current_uses     integer default 0,
  min_order_amount numeric default 0,
  created_at       timestamptz default now()
);

-- ── Indexes ──────────────────────────────────────────────────────

create index if not exists beats_available_idx   on beats(available);
create index if not exists beats_created_at_idx  on beats(created_at desc);
create index if not exists orders_order_id_idx   on orders(order_id);
create index if not exists coupons_code_idx      on coupons(code);

-- ── Helper functions ─────────────────────────────────────────────

-- Atomically increment coupon uses
create or replace function increment_coupon_uses(coupon_code text)
returns void language sql security definer as $$
  update coupons set current_uses = current_uses + 1 where code = coupon_code;
$$;

-- Bulk-update beat license prices (prices is a JSON object like {"Basic": 29.99, "Premium": 49.99})
create or replace function bulk_update_beat_license_prices(prices jsonb)
returns void language plpgsql security definer as $$
declare
  license_type text;
  new_price    numeric;
begin
  for license_type, new_price in
    select key, value::numeric from jsonb_each_text(prices)
  loop
    update beats
    set licenses = (
      select jsonb_agg(
        case
          when (elem->>'type') = license_type
          then jsonb_set(elem, '{price}', to_jsonb(new_price))
          else elem
        end
      )
      from jsonb_array_elements(licenses) as elem
    )
    where licenses @> jsonb_build_array(jsonb_build_object('type', license_type));
  end loop;
end;
$$;

-- ── Row Level Security ───────────────────────────────────────────
-- Backend uses the service_role key which bypasses RLS.
-- Enable RLS later per-table if you add public/customer-facing queries.

alter table beats      disable row level security;
alter table packs      disable row level security;
alter table beat_packs disable row level security;
alter table licenses   disable row level security;
alter table customers  disable row level security;
alter table orders     disable row level security;
alter table coupons    disable row level security;
