create or replace function public.apply_paper_cash_delta(p_portfolio_id uuid, p_delta numeric)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric;
  v_positions numeric;
begin
  update public.paper_portfolios p
     set balance = p.balance + p_delta,
         updated_at = now()
   where p.id = p_portfolio_id
     and (auth.uid() is null or p.user_id = auth.uid())
  returning p.balance into v_balance;

  if v_balance is null then
    raise exception 'portfolio not found or not permitted';
  end if;

  select coalesce(sum(quantity * entry_price), 0) into v_positions
    from public.paper_trades
   where portfolio_id = p_portfolio_id and is_open;

  update public.paper_portfolios
     set equity = v_balance + v_positions
   where id = p_portfolio_id;

  return v_balance;
end;
$$;

grant execute on function public.apply_paper_cash_delta(uuid, numeric) to authenticated, service_role;

with agg as (
  select
    p.id,
    coalesce(p.starting_balance, 10000) as start_bal,
    coalesce((select sum(coalesce(t.pnl, 0)) from public.paper_trades t where t.portfolio_id = p.id and t.is_open = false), 0) as realized,
    coalesce((select sum(t.quantity * t.entry_price) from public.paper_trades t where t.portfolio_id = p.id and t.is_open), 0) as open_cost
  from public.paper_portfolios p
)
update public.paper_portfolios p
   set balance = agg.start_bal + agg.realized - agg.open_cost,
       equity = agg.start_bal + agg.realized,
       updated_at = now()
  from agg
 where p.id = agg.id;