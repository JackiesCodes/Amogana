-- 0002: real vs demo money now comes from the broker account; paper mode is removed.
-- Idempotent: safe to run more than once.

alter table bots drop column if exists book;
alter table settings drop column if exists paper_starting_balance;

-- Paper trades and equity points were simulated; drop them.
alter table trades drop constraint if exists trades_book_check;
alter table trades drop constraint if exists trades_size_unit_check;
delete from trades where book = 'paper' or size_unit = 'units';
update trades t set book = case when b.is_demo then 'demo' else 'real' end
  from brokers b where t.broker_account_id = b.id and t.book not in ('real', 'demo');
update trades set book = 'real' where book not in ('real', 'demo');
alter table trades add constraint trades_book_check check (book in ('real', 'demo'));
alter table trades add constraint trades_size_unit_check check (size_unit in ('lots', 'stake'));

alter table equity drop constraint if exists equity_book_check;
delete from equity where book not in ('real', 'demo');
alter table equity add constraint equity_book_check check (book in ('real', 'demo'));

-- Risk baselines restart from current equity on the next engine run.
update settings
  set books = '{"real":{"peak_equity":0,"day_key":"","day_start_equity":0},"demo":{"peak_equity":0,"day_key":"","day_start_equity":0}}'::jsonb
  where not (books ? 'real' and books ? 'demo');
