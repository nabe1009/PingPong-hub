# Clerk と Supabase の JWT 連携（最初から手順）

RLS で「本人だけ」制限をかけるために、Clerk のユーザーを Supabase に認識させる手順です。

---

## 前提

- 認証: **Clerk**
- DB: **Supabase**（RLS 有効）
- アプリから Supabase にリクエストするときに **Clerk の JWT を Authorization ヘッダーで渡す**と、Supabase がその JWT を検証し、`auth.jwt() ->> 'sub'` に Clerk の user id が入るようになります。

---

## Step 1: Supabase の JWT Secret を控える

1. [Supabase Dashboard](https://supabase.com/dashboard) → 対象プロジェクトを開く
2. **Project Settings**（左メニュー下の歯車）→ **API**
3. **JWT Keys** または **Legacy JWT Secret** のタブを開く
4. **Legacy JWT secret** の **Reveal** をクリックし、表示された値をコピー  
   - この値は **Supabase 側では変更しない**（anon / service_role の検証に使われているため）
   - 次の Step で **Clerk の JWT テンプレートの署名キー** にこの値を入れます

---

## Step 2: Clerk で Supabase 用 JWT テンプレートを作る

1. [Clerk Dashboard](https://dashboard.clerk.com) → 対象アプリを開く
2. 左メニュー **Configure** → **JWT Templates**
3. **New template** → **Supabase** を選ぶ（または **Blank** で自作）
4. テンプレート名を付ける（例: `supabase`）  
   - アプリでは `getToken({ template: "supabase" })` でこのテンプレートを指定します
5. **Signing key** を設定する:
   - **Signing algorithm**: HS256 のまま
   - **Signing key**: Step 1 でコピーした **Supabase の JWT Secret** をそのまま貼り付ける
6. **Token lifetime**: 60 秒だと切れやすいので、**3600**（1時間）や **300**（5分）にすると運用しやすいです。
7. **Claims** はデフォルトのままでよい（`sub` に Clerk の user id が入ります）
8. **Save** で保存

これで、Clerk が「Supabase の secret で署名した JWT」を発行するようになります。

---

## Step 3: アプリで「Clerk の JWT を付けた Supabase クライアント」を使う

### 3-1. サーバー用クライアント（Server Actions 用）

- すでに `lib/supabase/server.ts` に **createSupabaseServerClient()** を用意してあります。
- この関数は `auth().getToken({ template: "supabase" })` でトークンを取り、  
  `createClient(..., { global: { headers: { Authorization: "Bearer ..." } } })` で渡しています。
- **Server Action では** `createClient(supabaseUrl, supabaseAnonKey)` の代わりに  
  **createSupabaseServerClient()** を使ってください。

対象例:

- `app/actions/team-members.ts`
- `app/actions/create-practices-with-recurrence.ts`
- `app/actions/toggle-comment-like.ts`
- `app/actions/delete-practice.ts`
- `app/actions/update-recurrence-rule.ts`
- `app/actions/get-organizer-teams.ts`
- `app/actions/get-practices.ts`
- `app/actions/update-practice.ts`
- `app/actions/post-practice-comment.ts`
- `app/actions/toggle-participation.ts`

各ファイルで:

- `import { createClient } from "@supabase/supabase-js"` と `supabaseUrl` / `supabaseAnonKey` で `createClient` している箇所を、
- `import { createSupabaseServerClient } from "@/lib/supabase/server"` に変え、
- `const supabase = createClient(...)` を **`const supabase = await createSupabaseServerClient()`** に変更してください。

（`createSupabaseServerClient` は async なので `await` が必要です。）

### 3-2. クライアント（ブラウザから supabase.from() を呼ぶ場合）

- `app/account/page.tsx` や `app/page.tsx` などで `import { supabase } from "@/lib/supabase/client"` を使っている箇所では、  
  そのクライアントにも Clerk の JWT を渡す必要があります。
- 方法: `lib/supabase/client.ts` の `createClient` に **global.fetch** を渡し、  
  その中で Clerk の `getToken({ template: "supabase" })` を呼んで **Authorization** ヘッダーに付ける。
- Clerk はブラウザでは `window.Clerk` や React の `useAuth()` から `getToken` を取得できるので、  
  プロバイダーで「トークン取得関数」を渡し、Supabase の fetch ラップで使う形にします。

（現在、多くの読み取りは Server Components や Server Actions 経由であれば、まずは Server 側の差し替えだけで試してもよいです。）

---

## Step 4: RLS ポリシーで「Clerk の user id」を使う

- DB の `user_id` は **Clerk の user id（文字列）** なので、  
  Supabase の `auth.uid()`（UUID 想定）ではなく、**JWT の sub** と比較します。
- ポリシー例（本人の行だけ見せる・触れる）:
  - **SELECT**: `(auth.jwt() ->> 'sub') = user_id`
  - **INSERT**: `WITH CHECK ( (auth.jwt() ->> 'sub') = user_id )`
  - **UPDATE / DELETE**: `USING ( (auth.jwt() ->> 'sub') = user_id )`

例（practices の「作成者だけ編集可能」）:

```sql
create policy "practices_update_own"
  on public.practices for update
  using ( (auth.jwt() ->> 'sub') = user_id )
  with check ( (auth.jwt() ->> 'sub') = user_id );

create policy "practices_delete_own"
  on public.practices for delete
  using ( (auth.jwt() ->> 'sub') = user_id );
```

- 未ログイン時は `auth.jwt() ->> 'sub'` が null になるので、上記条件では弾かれ、RLS で保護されます。

---

## チェックリスト

- [ ] Step 1: Supabase の JWT Secret をコピー（Reveal で表示した値）
- [ ] Step 2: Clerk で JWT テンプレート（例: 名前 `supabase`）を作成し、**Signing key = Supabase の JWT Secret** に設定
- [ ] Step 3: Server Actions で `createSupabaseServerClient()` に差し替え
- [ ] （必要なら）ブラウザから呼ぶ Supabase クライアントにも Clerk JWT を付与
- [ ] Step 4: RLS ポリシーを `auth.jwt() ->> 'sub'` と `user_id` の比較に変更

ここまでできれば、「制限をかけたらエラーになりまくる」状態を避けつつ、RLS で本人だけに制限できます。
