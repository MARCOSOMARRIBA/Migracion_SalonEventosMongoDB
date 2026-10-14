// Importa atlas_import/ a MongoDB Atlas. Se puede repetir sin duplicar (reemplaza por _id) y NO borra nada.
// Uso:  npm run importar
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { MongoClient } from 'mongodb';
import { EJSON } from 'bson';

const OUT = path.resolve(import.meta.dirname, '..', 'atlas_import');
const COL = path.join(OUT, 'colecciones');
const { ATLAS_URI, ATLAS_DB = 'los_chaneques' } = process.env;
if (!ATLAS_URI) throw new Error('Falta ATLAS_URI en .env (cadena mongodb+srv://... de Atlas)');
if (!fs.existsSync(COL)) throw new Error('No existe atlas_import/colecciones. Ejecuta primero: npm run convertir');

const indices = JSON.parse(fs.readFileSync(path.join(OUT, 'indices.json'), 'utf8'));
const validadores = JSON.parse(fs.readFileSync(path.join(OUT, 'validadores.json'), 'utf8'));

const client = new MongoClient(ATLAS_URI, { serverSelectionTimeoutMS: 15000 });
try {
  await client.connect();
  const db = client.db(ATLAS_DB);
  const existentes = new Set((await db.listCollections().toArray()).map(c => c.name));
  const resultado = [];

  for (const file of fs.readdirSync(COL).filter(f => f.endsWith('.jsonl')).sort()) {
    const nombre = path.basename(file, '.jsonl');
    const docs = fs.readFileSync(path.join(COL, file), 'utf8').split('\n').filter(Boolean).map(l => EJSON.parse(l));

    if (!existentes.has(nombre)) {
      await db.createCollection(nombre, validadores[nombre] ? { validator: { $jsonSchema: validadores[nombre] }, validationLevel: 'moderate' } : {});
    }
    const col = db.collection(nombre);
    if (docs.length) {
      await col.bulkWrite(docs.map(d => ({ replaceOne: { filter: { _id: d._id }, replacement: d, upsert: true } })), { ordered: false });
    }
    for (const ix of indices[nombre] ?? []) await col.createIndex(ix.key, { unique: !!ix.unique });
    const enAtlas = await col.countDocuments();
    resultado.push({ coleccion: nombre, origen: docs.length, enAtlas, ok: enAtlas >= docs.length });
  }

  console.table(resultado);
  console.log(resultado.every(r => r.ok) ? '✅ Importación completa y verificada.' : '❌ Hay colecciones con menos documentos de los esperados.');
} finally {
  await client.close();
}
