// Convierte la base PostgreSQL (solo lectura) en colecciones de documentos para MongoDB Atlas.
// Salida: atlas_import/colecciones/<coleccion>.jsonl  (Extended JSON, un documento por línea)
//         atlas_import/indices.json, atlas_import/validadores.json, atlas_import/resumen.json
// Uso:  npm run convertir
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { EJSON, Decimal128 } from 'bson';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'atlas_import');
const COL = path.join(OUT, 'colecciones');

if (!process.env.ORIGEN_DATABASE_URL) throw new Error('Falta ORIGEN_DATABASE_URL en .env');

// Tipos de Postgres → tipos exactos de MongoDB
pg.types.setTypeParser(1082, v => v);                                   // date  → "YYYY-MM-DD" (sin zona horaria)
pg.types.setTypeParser(1083, v => v);                                   // time  → "HH:MM:SS"
pg.types.setTypeParser(1700, v => Decimal128.fromString(v));            // numeric (precios) → Decimal128
pg.types.setTypeParser(1114, v => new Date(v.replace(' ', 'T') + 'Z')); // timestamp (guardado en UTC) → Date

const db = new pg.Pool({ connectionString: process.env.ORIGEN_DATABASE_URL, ssl: { rejectUnauthorized: false } });
const q = async (sql) => (await db.query(sql)).rows;
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

// ── Transformaciones (camelCase, el uuid original pasa a ser _id) ──
const users = (await q('SELECT * FROM users ORDER BY created_at')).map(r => clean({
  _id: r.id, name: r.name, email: r.email, password: r.password, role: r.role, phone: r.phone,
  isActive: r.is_active, createdAt: r.created_at, updatedAt: r.updated_at,
}));
const userById = new Map(users.map(u => [u._id, u]));

const foodPackages = (await q('SELECT * FROM food_packages ORDER BY created_at')).map(r => ({
  _id: r.id, name: r.name, description: r.description, items: r.items ?? [], basePrice: r.base_price,
  imageUrl: r.image_url, isActive: r.is_active, createdAt: r.created_at, updatedAt: r.updated_at,
}));
const pkgById = new Map(foodPackages.map(p => [p._id, p]));

// Reservaciones: incrementamos con copias del cliente y del paquete (patrón "extended reference")
const reservations = (await q('SELECT * FROM reservations ORDER BY created_at')).map(r => {
  const u = userById.get(r.client_id), p = r.package_id ? pkgById.get(r.package_id) : null;
  return {
    _id: r.id,
    clientId: r.client_id,
    client: u ? { name: u.name, email: u.email, phone: u.phone ?? null } : null,
    eventType: r.event_type, eventDate: r.event_date, eventTime: r.event_time, guestCount: r.guest_count,
    packageId: r.package_id,
    package: p ? { name: p.name, basePrice: p.basePrice } : null,
    totalPrice: r.total_price, status: r.status, paymentStatus: r.payment_status, paymentId: r.payment_id,
    specialRequests: r.special_requests, createdAt: r.created_at, updatedAt: r.updated_at,
  };
});

// Chat: los mensajes pasan a ser un arreglo dentro de cada conversación (una sola lectura por chat)
const entries = await q('SELECT * FROM chat_entries ORDER BY created_at');
const chatConversations = (await q('SELECT * FROM chat_conversations ORDER BY created_at')).map(r => ({
  _id: r.id, guestToken: r.guest_token, guestName: r.guest_name, guestContact: r.guest_contact,
  unreadByAdmin: r.unread_by_admin, lastMessageAt: r.last_message_at, createdAt: r.created_at,
  messages: entries.filter(e => e.conversation_id === r.id).map(e => ({ _id: e.id, sender: e.sender, message: e.message, createdAt: e.created_at })),
}));

const pageSections = (await q('SELECT * FROM page_sections ORDER BY "order"')).map(r => ({
  _id: r.id, sectionKey: r.section_key, title: r.title, content: r.content, imageUrl: r.image_url,
  isActive: r.is_active, order: r.order, updatedAt: r.updated_at,
}));
const galleryImages = (await q('SELECT * FROM gallery_images ORDER BY "order", created_at')).map(r => ({
  _id: r.id, url: r.url, caption: r.caption, description: r.description, order: r.order,
  isActive: r.is_active, createdAt: r.created_at, updatedAt: r.updated_at,
}));
const galleryHistory = (await q('SELECT * FROM gallery_history ORDER BY created_at')).map(r => ({
  _id: r.id, imageId: r.image_id, imageUrl: r.image_url, action: r.action, caption: r.caption,
  description: r.description, createdAt: r.created_at,
}));
const testimonials = (await q('SELECT * FROM testimonials ORDER BY created_at')).map(r => ({
  _id: r.id, name: r.name, event: r.event, text: r.text, avatarUrl: r.avatar_url, isActive: r.is_active, createdAt: r.created_at,
}));
const advertisements = (await q('SELECT * FROM advertisements ORDER BY created_at')).map(r => ({
  _id: r.id, title: r.title, description: r.description, imageUrl: r.image_url, link: r.link,
  startDate: r.start_date, endDate: r.end_date, position: r.position, isActive: r.is_active,
  createdAt: r.created_at, updatedAt: r.updated_at,
}));
const userSessions = (await q('SELECT * FROM user_sessions')).map(r => ({
  _id: r.id, userId: r.user_id, sessionId: r.session_id, lastActivity: r.last_activity, ipAddress: r.ip_address, userAgent: r.user_agent,
}));

const colecciones = { users, foodPackages, reservations, chatConversations, pageSections, galleryImages, galleryHistory, testimonials, advertisements, userSessions };

// ── Índices y validadores ──
const indices = {
  users: [{ key: { email: 1 }, unique: true }],
  foodPackages: [{ key: { isActive: 1 } }],
  reservations: [{ key: { eventDate: 1, status: 1 } }, { key: { clientId: 1, createdAt: -1 } }],
  chatConversations: [{ key: { guestToken: 1 }, unique: true }, { key: { lastMessageAt: -1 } }],
  pageSections: [{ key: { sectionKey: 1 }, unique: true }],
  galleryImages: [{ key: { order: 1 } }],
  galleryHistory: [{ key: { imageId: 1, createdAt: -1 } }],
  advertisements: [{ key: { isActive: 1, startDate: 1, endDate: 1 } }],
  userSessions: [{ key: { userId: 1 } }],
};
const validadores = {
  users: { bsonType: 'object', required: ['_id', 'name', 'email', 'role'], properties: { role: { enum: ['admin', 'client'] } } },
  foodPackages: { bsonType: 'object', required: ['_id', 'name', 'basePrice'], properties: { basePrice: { bsonType: 'decimal' }, items: { bsonType: 'array' } } },
  reservations: { bsonType: 'object', required: ['_id', 'clientId', 'eventType', 'eventDate', 'guestCount', 'status'],
    properties: { status: { enum: ['pending', 'confirmed', 'cancelled', 'completed'] }, paymentStatus: { enum: ['pending', 'paid', 'refunded'] }, totalPrice: { bsonType: 'decimal' } } },
  chatConversations: { bsonType: 'object', required: ['_id', 'guestToken', 'messages'], properties: { messages: { bsonType: 'array' } } },
};

// ── Escritura ──
fs.rmSync(COL, { recursive: true, force: true });
fs.mkdirSync(COL, { recursive: true });
const resumen = {};
for (const [nombre, docs] of Object.entries(colecciones)) {
  fs.writeFileSync(path.join(COL, `${nombre}.jsonl`), docs.map(d => EJSON.stringify(d, { relaxed: true })).join('\n') + (docs.length ? '\n' : ''));
  resumen[nombre] = docs.length;
}
fs.writeFileSync(path.join(OUT, 'indices.json'), JSON.stringify(indices, null, 2));
fs.writeFileSync(path.join(OUT, 'validadores.json'), JSON.stringify(validadores, null, 2));
// El respaldo es de solo lectura: se copia el contenido (no el atributo) para poder repetir la conversión
fs.writeFileSync(path.join(OUT, 'estructura_origen_copia.sql'), fs.readFileSync(path.join(ROOT, 'respaldo', 'estructura_los_chaneques.sql')));
fs.writeFileSync(path.join(OUT, 'resumen.json'), JSON.stringify({ generado: new Date().toISOString(), documentos_por_coleccion: resumen,
  mensajes_de_chat_incrustados: chatConversations.reduce((n, c) => n + c.messages.length, 0) }, null, 2));

console.log('Colecciones generadas:', resumen);
console.log('Mensajes de chat incrustados:', chatConversations.reduce((n, c) => n + c.messages.length, 0));
await db.end();
