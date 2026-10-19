// Comprueba un backend desplegado (Render) y demuestra EN QUÉ BASE DE DATOS está escribiendo.
// Uso:  npm run comprobar -- https://TU-SERVICIO.onrender.com [https://tu-sitio.vercel.app]
//
// La prueba definitiva: pide a la API crear una conversación de chat anónima y busca esa conversación
// en Atlas y en Supabase. Después borra la conversación de prueba.
import 'dotenv/config';
import pg from 'pg';
import { MongoClient } from 'mongodb';

const API = (process.argv[2] || '').replace(/[/]+$/, '');
const FRONT = (process.argv[3] || '').replace(/[/]+$/, '');
if (!/^https?:[/][/]/.test(API)) {
  console.error('Uso: npm run comprobar -- https://TU-SERVICIO.onrender.com [https://tu-sitio.vercel.app]');
  process.exit(1);
}
const ok = (b, msg) => console.log(`${b ? '✅' : '❌'} ${msg}`);
const get = async (p, init) => { const r = await fetch(API + p, init); return { r, body: await r.json().catch(() => null) }; };

console.log(`\nProbando ${API}  (si el servicio estaba dormido, la primera respuesta puede tardar ~50 s)\n`);

// 1) Servicio vivo y datos públicos
let res = await fetch(API + '/', { signal: AbortSignal.timeout(120_000) });
ok(res.ok, `El servicio responde (HTTP ${res.status})`);
const gallery = (await get('/api/gallery')).body ?? [];
const packages = (await get('/api/packages')).body ?? [];
ok(gallery.length > 0, `Galería: ${gallery.length} imágenes`);
ok(packages.length > 0, `Paquetes: ${packages.length}`);
ok(packages.every(p => typeof p.basePrice === 'string'), 'Los precios llegan como texto ("18500.00"), como espera el frontend');

// 2) Encabezados de seguridad
const h = (await fetch(API + '/api/gallery')).headers;
ok(!!h.get('strict-transport-security'), 'Encabezado HSTS presente');
ok(h.get('x-content-type-options') === 'nosniff', 'Encabezado X-Content-Type-Options presente');

// 3) CORS desde el frontend (opcional)
if (FRONT) {
  const cors = (await fetch(API + '/api/gallery', { headers: { Origin: FRONT } })).headers.get('access-control-allow-origin');
  ok(cors === FRONT, `CORS permite a ${FRONT} ${cors === FRONT ? '' : '→ revisa FRONTEND_URL en Render'}`);
}
const evil = (await fetch(API + '/api/gallery', { headers: { Origin: 'https://sitio-externo.example' } })).headers.get('access-control-allow-origin');
ok(!evil, 'CORS bloquea orígenes ajenos');

// 4) ¿En qué base escribe la API?
const start = await get('/api/chat/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
const token = start.body?.token;
ok(!!token, 'La API creó una conversación de prueba');
const mongo = new MongoClient(process.env.ATLAS_URI);
await mongo.connect();
const inAtlas = !!(await mongo.db(process.env.ATLAS_DB).collection('chatConversations').findOne({ guestToken: token }));

let inSupabase = null;
if (process.env.ORIGEN_DATABASE_URL) {
  const pgc = new pg.Client({ connectionString: process.env.ORIGEN_DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await pgc.connect();
  inSupabase = (await pgc.query('select 1 from chat_conversations where guest_token = $1', [token])).rowCount > 0;
  if (inSupabase) await pgc.query('delete from chat_conversations where guest_token = $1', [token]); // limpia la prueba
  await pgc.end();
}
await mongo.db(process.env.ATLAS_DB).collection('chatConversations').deleteOne({ guestToken: token }); // limpia la prueba
await mongo.close();

console.log('');
if (inAtlas && !inSupabase) console.log('🍃 RESULTADO: la API escribe en MONGODB ATLAS. Ya puedes borrar DATABASE_URL en Render.');
else if (!inAtlas && inSupabase) console.log('🐘 RESULTADO: la API TODAVÍA escribe en SUPABASE (PostgreSQL). Falta desplegar el código nuevo o configurar MONGODB_URI en Render.');
else if (inAtlas && inSupabase) console.log('⚠️  RESULTADO: apareció en ambas bases; revisa la configuración.');
else console.log('❌ RESULTADO: no apareció en ninguna base. Revisa los Logs de Render.');
console.log('(La conversación de prueba ya se eliminó.)\n');
