import {createClient} from '@supabase/supabase-js';
window.VOCES_KEY='sb_publishable_332NSrk2y8yMUMc3asZ3sA_erS2ru0u';
window.VOCES_API='https://rpsqixjnkvvboiqbklnd.supabase.co/functions/v1/voces-api';
window.vocesAuth=createClient('https://rpsqixjnkvvboiqbklnd.supabase.co',window.VOCES_KEY,{auth:{storageKey:'voces-antorcha-session',persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
