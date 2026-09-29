// ═══════════════════════════════════════════════════════════════
//  admin-users — account management for the Gym Manager
//
//  POST { action, ... } with the caller's session token. Only the gym admin
//  may call it. Uses the service-role key, which never leaves this function.
//
//    create          { username, password, display_name?, role? }  → { id }
//    delete          { user_id }
//    reset_password  { user_id, password }
//    set_role        { user_id, role }
//
//  Members sign in with a username; Supabase Auth needs an email, so each
//  account gets `<username>@<USERNAME_EMAIL_DOMAIN>` (never mailed).
// ═══════════════════════════════════════════════════════════════
import { createClient } from 'npm:@supabase/supabase-js@2';

const DOMAIN = Deno.env.get('USERNAME_EMAIL_DOMAIN') ?? 'members.pmex-gym.local';
const ROLES = ['admin', 'mod', 'member'];
const USERNAME = /^[a-z0-9_.-]{3,32}$/;

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply(405, { error: 'POST only' });

  const url = Deno.env.get('SUPABASE_URL')!;
  const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  // Who is calling? Resolve the JWT, then check their role in profiles.
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: who, error: whoErr } = await service.auth.getUser(token);
  if (whoErr || !who?.user) return reply(401, { error: 'Chưa đăng nhập.' });
  const { data: me } = await service.from('profiles').select('id, role, display_name, username').eq('id', who.user.id).single();
  if (me?.role !== 'admin') return reply(403, { error: 'Chỉ admin được quản lý tài khoản.' });

  let body: Record<string, string>;
  try { body = await req.json(); } catch { return reply(400, { error: 'Body phải là JSON.' }); }
  const log = (action: string, detail: Record<string, unknown>) =>
    service.from('activity').insert({ actor: me.id, actor_name: me.display_name || me.username, action, detail });

  switch (body.action) {
    case 'create': {
      const username = String(body.username ?? '').trim().toLowerCase();
      const role = body.role ?? 'member';
      if (!USERNAME.test(username)) return reply(400, { error: 'Username 3–32 ký tự: chữ thường, số, _ . -' });
      if (String(body.password ?? '').length < 8) return reply(400, { error: 'Mật khẩu tối thiểu 8 ký tự.' });
      if (!ROLES.includes(role)) return reply(400, { error: 'Vai trò không hợp lệ.' });
      const { data, error } = await service.auth.admin.createUser({
        email: `${username}@${DOMAIN}`,
        password: body.password,
        email_confirm: true,
        user_metadata: { username, display_name: body.display_name ?? '' },
        app_metadata: { gym_role: role },
      });
      if (error) return reply(400, { error: /already/i.test(error.message) ? 'Username đã tồn tại.' : error.message });
      await log('account.create', { username, role });
      return reply(200, { id: data.user.id });
    }

    case 'delete': {
      if (body.user_id === me.id) return reply(400, { error: 'Không tự xoá tài khoản admin của mình.' });
      const { data: target } = await service.from('profiles').select('username, display_name').eq('id', body.user_id).single();
      // Cascades to profile, pairs, tower; runs keep member_name with user_id = null
      const { error } = await service.auth.admin.deleteUser(body.user_id);
      if (error) return reply(400, { error: error.message });
      await log('account.delete', { user_id: body.user_id, ...target });
      return reply(200, { ok: true });
    }

    case 'reset_password': {
      if (String(body.password ?? '').length < 8) return reply(400, { error: 'Mật khẩu tối thiểu 8 ký tự.' });
      const { error } = await service.auth.admin.updateUserById(body.user_id, { password: body.password });
      if (error) return reply(400, { error: error.message });
      await log('account.reset_password', { user_id: body.user_id });
      return reply(200, { ok: true });
    }

    case 'set_role': {
      if (!ROLES.includes(body.role)) return reply(400, { error: 'Vai trò không hợp lệ.' });
      if (body.user_id === me.id && body.role !== 'admin') return reply(400, { error: 'Không tự hạ quyền admin của mình.' });
      const { error } = await service.from('profiles').update({ role: body.role }).eq('id', body.user_id);
      if (error) return reply(400, { error: error.message });
      await service.auth.admin.updateUserById(body.user_id, { app_metadata: { gym_role: body.role } });
      await log('account.set_role', { user_id: body.user_id, role: body.role });
      return reply(200, { ok: true });
    }

    default:
      return reply(400, { error: 'action không hợp lệ.' });
  }
});
