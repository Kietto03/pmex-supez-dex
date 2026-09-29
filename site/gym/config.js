// Supabase project for the Gym Manager — see docs/gym-manager.md.
// The anon key is meant to be public: every table is protected by row-level security.
// Leave both empty to run the built-in demo (sample data in memory, nothing saved).
window.GYM_CONFIG = {
  supabaseUrl: '',          // e.g. 'https://abcdefghijkl.supabase.co'
  supabaseAnonKey: '',      // Project Settings → API → anon public key
  usernameDomain: 'members.pmex-gym.local',   // must match USERNAME_EMAIL_DOMAIN of the admin-users function
};
