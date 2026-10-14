# Migracion_Rentas

Migración de la base de datos de **Los Chaneques** (PostgreSQL en Supabase) a **MongoDB Atlas** (NoSQL).

## Estructura

| Carpeta | Contenido |
|---|---|
| `respaldo/` | Respaldo de solo lectura de la base original: `estructura_los_chaneques.sql` (tablas, llaves y restricciones), `respaldo_completo_los_chaneques.sql` (estructura + datos, **no se sube a GitHub**) y `conteos_origen.json` (filas por tabla, para verificar). |
| `atlas_import/` | Copia aparte que es la que se importa: colecciones convertidas a documentos (`colecciones/*.jsonl`, no se suben), `indices.json`, `validadores.json` y `resumen.json`. |
| `scripts/` | `convertir.mjs` (Postgres → documentos) e `importar-atlas.mjs` (documentos → Atlas). |

## Modelo de datos NoSQL

| Tabla(s) SQL | Colección MongoDB | Cambio |
|---|---|---|
| `users` | `users` | `_id` = uuid original |
| `food_packages` | `foodPackages` | `items` ya era arreglo; `basePrice` → `Decimal128` |
| `reservations` | `reservations` | incrusta copia del cliente (`client`) y del paquete (`package`); conserva `clientId`/`packageId` |
| `chat_conversations` + `chat_entries` | `chatConversations` | los mensajes pasan a un arreglo `messages` dentro de la conversación |
| `page_sections`, `gallery_images`, `gallery_history`, `testimonials`, `advertisements`, `user_sessions` | mismo nombre en camelCase | 1 a 1 |
| `chat_messages` | — | tabla heredada sin uso (0 filas); no se migra |

Fechas → `Date`; `date`/`time` (fecha y hora del evento) se conservan como texto `YYYY-MM-DD` / `HH:MM:SS` para no sufrir cambios de zona horaria.

## Uso

```bash
npm install
cp .env.example .env     # llena ORIGEN_DATABASE_URL y ATLAS_URI
npm run convertir        # genera atlas_import/ desde la base original (solo lectura)
npm run importar         # sube a Atlas y verifica conteos
```

En Atlas: *Network Access* debe permitir tu IP y el usuario de base de datos necesita permiso de lectura/escritura.
