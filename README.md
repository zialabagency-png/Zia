# ZIA Flow

ZIA Flow es un workspace visual para agencia, diseñado para ZIA Lab con una experiencia tipo **Trello + Monday** y módulos aterrizados a operación real: tareas, clientes, calendario, usuarios, invitaciones por email, recuperación de contraseña y adjuntos.

## Lo que ya trae

- Login con sesión por cookie segura
- Dashboard operativo
- Vista **Kanban** y vista **tabla**
- Calendario mensual de entregas y publicaciones
- CRUD de tareas
- CRUD de clientes
- Adjuntos por tarea
- Perfil propio para cambiar nombre, correo y contraseña
- **Dashboard Admin** para:
  - crear usuarios
  - editar nombre, correo, rol, estado y accent
  - enviar invitaciones por email
  - enviar correos de reset
  - resetear contraseña manualmente por API
  - ver log reciente de correos
- Recuperación de contraseña por email
- Activación de cuenta por invitación
- SMTP listo para invitaciones, recuperación y recordatorios de tareas
- Ajustes de notificaciones por admin + ejecución manual de recordatorios
- Estilo visual oscuro inspirado en el branding de **ZIA Lab**

## Stack

- Node.js
- Express
- PostgreSQL con `pg` cuando existe `DATABASE_URL`
- Fallback local a `data/db.json` para demo rápida sin base de datos
- Multer para adjuntos
- Nodemailer para invitaciones y recuperación
- Frontend HTML + CSS + JavaScript

## Ejecutar en local

```bash
npm install
npm start
```

Abrir:

```bash
http://localhost:3000
```

## Demo local

Credenciales iniciales:

- Correo: `zia@agency.local`
- Clave: `ZiaFlow2026!`

## Variables de entorno

### Base

- `PORT=3000`
- `APP_BASE_URL=http://localhost:3000`
- `COOKIE_SECURE=false`
- `SEED_ADMIN_PASSWORD=ZiaFlow2026!`
- `MAX_UPLOAD_BYTES=15728640`

### PostgreSQL

- `DATABASE_URL=postgresql://...`
- `DATABASE_SSL=true` solo si tu proveedor lo requiere

### Email SMTP

- `SMTP_HOST=smtp.tudominio.com`
- `SMTP_PORT=587`
- `SMTP_SECURE=false`
- `SMTP_USER=usuario`
- `SMTP_PASS=clave`
- `SMTP_FROM=ZIA Flow <no-reply@tudominio.com>`

### Recordatorios

- `APP_TIMEZONE=America/Santo_Domingo`
- `REMINDER_ENABLED=true`
- `REMINDER_AUTO_RUN=true`
- `REMINDER_INTERVAL_MINUTES=15`
- `REMINDER_ASSIGNMENT_EMAILS=true`
- `REMINDER_DAILY_DIGEST=true`
- `REMINDER_DIGEST_HOUR=8`
- `REMINDER_WEEKEND_DIGEST=true`
- `REMINDER_DUE_SOON=true`
- `REMINDER_DUE_SOON_HOURS=24`
- `REMINDER_OVERDUE=true`
- `REMINDER_OVERDUE_REPEAT_HOURS=24`

## Cómo funciona el email en desarrollo

Si todavía no configuras SMTP, el sistema no se rompe. En vez de enviar el correo real:

- guarda el evento en el log interno
- devuelve un `previewLink` para abrir el flujo de invitación o reset inmediatamente
- los recordatorios de tareas también quedan registrados para validación interna

Esto ayuda mucho mientras montas el proyecto o haces pruebas en Render.

## Despliegue en Render

1. Sube el proyecto a GitHub.
2. Crea un **Web Service** en Render.
3. Conecta el repo.
4. Adjunta una base de datos PostgreSQL y copia su `DATABASE_URL`.
5. Configura `APP_BASE_URL` con la URL pública del servicio.
6. Configura SMTP si quieres emails reales.
7. Deploy.

### Recomendación importante para adjuntos

Los adjuntos se guardan en `data/uploads/`.

Para producción en Render, lo ideal es usar uno de estos caminos:

- un **persistent disk** si quieres seguir guardando archivos en el servidor
- o mejor aún, mover adjuntos luego a S3 / Cloudinary / similar

## Estructura

```text
zia-flow/
├─ data/
│  ├─ db.json
│  └─ uploads/
├─ public/
│  ├─ app.js
│  ├─ index.html
│  └─ styles.css
├─ package.json
├─ render.yaml
├─ README.md
└─ server.js
```

## Nota técnica

- Si existe `DATABASE_URL`, ZIA Flow crea sus tablas automáticamente en PostgreSQL.
- Si no existe, usa `data/db.json` para que puedas abrirlo al instante sin bloquear el desarrollo.
- El scheduler de recordatorios corre en el mismo servidor con `setInterval`; en Render funciona bien mientras el servicio esté activo.
- También puedes disparar recordatorios manualmente desde el panel Admin.
