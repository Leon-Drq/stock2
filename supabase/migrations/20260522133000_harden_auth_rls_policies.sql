create index if not exists credit_transactions_user_id_idx
  on public.credit_transactions (user_id);

create index if not exists projects_user_id_idx
  on public.projects (user_id);

alter policy "Users can view own subscription"
  on public.subscriptions
  using ((select auth.uid()) = user_id);

alter policy profiles_select_own
  on public.profiles
  using ((select auth.uid()) = id);

alter policy profiles_insert_own
  on public.profiles
  with check ((select auth.uid()) = id);

alter policy profiles_update_own
  on public.profiles
  using ((select auth.uid()) = id);

alter policy profiles_delete_own
  on public.profiles
  using ((select auth.uid()) = id);

alter policy transactions_select_own
  on public.credit_transactions
  using ((select auth.uid()) = user_id);

alter policy transactions_insert_own
  on public.credit_transactions
  with check ((select auth.uid()) = user_id);

alter policy projects_insert_admin
  on public.projects
  with check (false);

alter policy projects_update_admin
  on public.projects
  using (false);

alter policy projects_delete_admin
  on public.projects
  using (false);
