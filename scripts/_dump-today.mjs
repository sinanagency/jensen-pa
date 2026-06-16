import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
const env = fs.readFileSync('.env.local','utf8').split('\n').reduce((a,l)=>{const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)a[m[1]]=m[2].replace(/^["']|["']$/g,'');return a;},{});
const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY;
const sb = createClient(url, key);
const since = '2026-06-16T00:00:00+04:00';
const until = '2026-06-17T00:00:00+04:00';
const { data, error } = await sb.from('chat_messages').select('*').gte('created_at', since).lt('created_at', until).order('created_at',{ascending:true});
if (error){ console.error(JSON.stringify(error)); process.exit(1); }
console.log('rows:', data.length);
fs.writeFileSync(path.join(process.env.CLAUDE_JOB_DIR,'dorje-2026-06-16.json'), JSON.stringify(data,null,2));
console.log('first ts:', data[0]?.created_at, 'last ts:', data[data.length-1]?.created_at);
