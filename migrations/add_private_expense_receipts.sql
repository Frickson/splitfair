-- Private receipt attachments for expenses in SplitFair.
-- Paths: group_id/expense_id/random-uuid.jpg
alter table public.expenses
  add column if not exists receipt_path text;

alter table public.expenses drop constraint if exists expenses_receipt_path_format;
alter table public.expenses add constraint expenses_receipt_path_format
check (
  receipt_path is null or (
    length(receipt_path) <= 190
    and split_part(receipt_path,'/',1)=group_id::text
    and split_part(receipt_path,'/',2)=id::text
    and split_part(receipt_path,'/',3) ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.jpg$'
    and split_part(receipt_path,'/',4)=''
  )
);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('splitfair-expense-receipts','splitfair-expense-receipts',false,5242880,array['image/jpeg'])
on conflict(id) do update
set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "SplitFair group members view expense receipts" on storage.objects;
create policy "SplitFair group members view expense receipts"
on storage.objects for select to authenticated
using (
  bucket_id='splitfair-expense-receipts'
  and exists(
    select 1 from public.group_members gm
    where gm.group_id::text=(storage.foldername(name))[1]
      and gm.user_id=(select auth.uid())
  )
);

drop policy if exists "SplitFair expense creators upload receipts" on storage.objects;
create policy "SplitFair expense creators upload receipts"
on storage.objects for insert to authenticated
with check (
  bucket_id='splitfair-expense-receipts'
  and lower(storage.extension(name))='jpg'
  and (storage.foldername(name))[3] is null
  and exists(
    select 1 from public.expenses e
    where e.group_id::text=(storage.foldername(name))[1]
      and e.id::text=(storage.foldername(name))[2]
      and e.created_by=(select auth.uid())
      and public.is_group_member(e.group_id)
  )
);

drop policy if exists "SplitFair receipt uploaders remove their files" on storage.objects;
create policy "SplitFair receipt uploaders remove their files"
on storage.objects for delete to authenticated
using (
  bucket_id='splitfair-expense-receipts'
  and owner_id=(select auth.uid())::text
  and exists(
    select 1 from public.group_members gm
    where gm.group_id::text=(storage.foldername(name))[1]
      and gm.user_id=(select auth.uid())
  )
);