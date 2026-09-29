/* ═══════════════════════════════════════════════════════════════
   Data access. One interface, two backends:
   · Supabase (config.js filled in)  — the real gym database
   · Demo (no config, or ?demo)      — in-memory sample data, nothing saved
   Every method returns plain rows and throws Error(message) on failure.
   ═══════════════════════════════════════════════════════════════ */

const CFG = window.GYM_CONFIG || {};
export const isDemo = !CFG.supabaseUrl || !CFG.supabaseAnonKey || new URLSearchParams(location.search).has('demo');

export async function createApi() {
  if (isDemo) {
    const { createDemoApi } = await import('./demo.js');
    return createDemoApi();
  }
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  return supabaseApi(createClient(CFG.supabaseUrl, CFG.supabaseAnonKey));
}

const DOMAIN = CFG.usernameDomain || 'members.pmex-gym.local';

function supabaseApi(sb) {
  // PostgREST / trigger errors → the Vietnamese message raised in SQL
  const ok = ({ data, error }) => {
    if (error) throw new Error(error.message || String(error));
    return data;
  };

  return {
    mode: 'supabase',

    // ─── Session ───
    async session() {
      const { data } = await sb.auth.getSession();
      return data.session ? data.session.user.id : null;
    },
    async signIn(username, password) {
      const { error } = await sb.auth.signInWithPassword({ email: `${username.trim().toLowerCase()}@${DOMAIN}`, password });
      if (error) throw new Error(/invalid/i.test(error.message) ? 'Sai username hoặc mật khẩu.' : error.message);
    },
    async signOut() { await sb.auth.signOut(); },
    async changePassword(password) {
      const { error } = await sb.auth.updateUser({ password });
      if (error) throw new Error(error.message);
    },

    // ─── Accounts (admin, via the Edge Function) ───
    async adminUsers(body) {
      const { data, error } = await sb.functions.invoke('admin-users', { body });
      if (error) {
        let msg = error.message;
        try { msg = (await error.context.json()).error || msg; } catch { /* keep generic */ }
        throw new Error(msg);
      }
      return data;
    },

    // ─── Tables ───
    profiles: async () => ok(await sb.from('profiles').select('*').order('display_name')),
    updateProfile: async (id, patch) => ok(await sb.from('profiles').update(patch).eq('id', id).select().single()),

    catalogCount: async () => (await sb.from('pair_catalog').select('id', { count: 'exact', head: true })).count || 0,
    async syncCatalog(rows) {
      for (let i = 0; i < rows.length; i += 200) ok(await sb.from('pair_catalog').upsert(rows.slice(i, i + 200)));
    },

    memberPairs: async () => ok(await sb.from('member_pairs').select('*')),
    upsertMemberPair: async row => ok(await sb.from('member_pairs').upsert(row).select().single()),
    deleteMemberPair: async (user_id, pair_id) => ok(await sb.from('member_pairs').delete().match({ user_id, pair_id })),

    tower: async () => ok(await sb.from('tower_progress').select('*')),
    upsertTower: async row => ok(await sb.from('tower_progress').upsert(row).select().single()),

    seasons: async () => ok(await sb.from('seasons').select('*').order('battle_start', { ascending: false })),
    createSeason: async row => ok(await sb.from('seasons').insert(row).select().single()),
    updateSeason: async (id, patch) => ok(await sb.from('seasons').update(patch).eq('id', id).select().single()),
    async setActiveSeason(id) {
      ok(await sb.from('seasons').update({ is_active: false }).eq('is_active', true));
      if (id) ok(await sb.from('seasons').update({ is_active: true }).eq('id', id));
    },
    deleteSeason: async id => ok(await sb.from('seasons').delete().eq('id', id)),

    seasonMembers: async sid => ok(await sb.from('season_members').select('*').eq('season_id', sid)),
    setBanned: async (season_id, user_id, banned) => ok(await sb.from('season_members').upsert({ season_id, user_id, banned })),

    runs: async sid => ok(await sb.from('runs').select('*').eq('season_id', sid).order('created_at', { ascending: false })),
    createRun: async row => ok(await sb.from('runs').insert(row).select().single()),
    updateRun: async (id, patch) => ok(await sb.from('runs').update(patch).eq('id', id).select().single()),
    deleteRun: async id => ok(await sb.from('runs').delete().eq('id', id)),

    assignments: async sid => ok(await sb.from('assignments').select('*').eq('season_id', sid)),
    addAssignment: async row => ok(await sb.from('assignments').upsert(row)),
    removeAssignment: async (season_id, leader, user_id) => ok(await sb.from('assignments').delete().match({ season_id, leader, user_id })),

    notes: async sid => ok(await sb.from('leader_notes').select('*').eq('season_id', sid)),
    saveNote: async row => ok(await sb.from('leader_notes').upsert(row)),

    activity: async () => ok(await sb.from('activity').select('*').order('at', { ascending: false }).limit(200)),
  };
}
