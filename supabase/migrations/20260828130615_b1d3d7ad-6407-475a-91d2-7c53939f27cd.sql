create or replace function public.apply_paper_cash_delta(p_portfolio_id uuid, p_delta numeric)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric;
  v_positions numeric;
  v_uid uuid := auth.uid();
begin
  if v_uid is null and current_user <> 'service_role' then
    raise exception 'not permitted';
  end if;

  update public.paper_portfolios p
     set balance = p.balance + p_delta,
         updated_at = now()
   where p.id = p_portfolio_id
     and (v_uid is null or p.user_id = v_uid)
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

revoke all on function public.apply_paper_cash_delta(uuid, numeric) from public;
revoke all on function public.apply_paper_cash_delta(uuid, numeric) from anon;
grant execute on function public.apply_paper_cash_delta(uuid, numeric) to authenticated, service_role;