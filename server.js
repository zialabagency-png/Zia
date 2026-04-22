const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const nodemailer = require('nodemailer');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const SESSION_COOKIE = 'zia_session';
const SESSION_DAYS = 30;
const STATUS_ORDER = ['not_started', 'in_progress', 'review', 'sent', 'approved', 'scheduled'];
const TOKEN_TYPES = { INVITE: 'invite', RESET: 'reset' };
const APP_BASE_URL = process.env.APP_BASE_URL || `http://localhost:${PORT}`;

ensureDir(DATA_DIR);
ensureDir(UPLOADS_DIR);

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

const upload = multer({
  dest: UPLOADS_DIR,
  limits: { fileSize: Number(process.env.MAX_UPLOAD_BYTES || 15 * 1024 * 1024) }
});

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function nowIso() {
  return new Date().toISOString();
}

function generateId(prefix = 'id') {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 64, 'sha512').toString('hex');
  return `${salt}$${hash}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || !password || !storedHash.includes('$')) return false;
  const [salt, hash] = storedHash.split('$');
  const candidate = crypto.pbkdf2Sync(password, salt, 120000, 64, 'sha512').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(hash, 'hex'));
}

function sanitizeUser(user) {
  if (!user) return null;
  const { passwordHash, ...safe } = user;
  return safe;
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return header.split(';').reduce((acc, item) => {
    const [rawKey, ...rest] = item.trim().split('=');
    if (!rawKey) return acc;
    acc[rawKey] = decodeURIComponent(rest.join('='));
    return acc;
  }, {});
}

function setSessionCookie(res, token) {
  const cookieParts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_DAYS * 24 * 60 * 60}`
  ];
  if (process.env.COOKIE_SECURE === 'true') {
    cookieParts.push('Secure');
  }
  res.setHeader('Set-Cookie', cookieParts.join('; '));
}

function clearSessionCookie(res) {
  const cookieParts = [
    `${SESSION_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0'
  ];
  if (process.env.COOKIE_SECURE === 'true') {
    cookieParts.push('Secure');
  }
  res.setHeader('Set-Cookie', cookieParts.join('; '));
}

function normalizeDate(value) {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqStrings(values = []) {
  return [...new Set(normalizeArray(values).map((item) => String(item || '').trim()).filter(Boolean))];
}

function mapLegacyStatus(status) {
  const value = String(status || '').trim().toLowerCase();
  if (STATUS_ORDER.includes(value)) return value;
  const legacyMap = {
    brief: 'not_started',
    copy: 'in_progress',
    design: 'in_progress',
    doing: 'in_progress',
    review: 'review',
    client: 'sent',
    approved: 'approved',
    scheduled: 'scheduled',
    published: 'scheduled',
    'sin iniciar': 'not_started',
    'en proceso': 'in_progress',
    revisión: 'review',
    revision: 'review',
    enviado: 'sent',
    aprobado: 'approved',
    programado: 'scheduled'
  };
  return legacyMap[value] || 'not_started';
}

function statusText(value) {
  return {
    not_started: 'Sin iniciar',
    in_progress: 'En proceso',
    review: 'Revisión',
    sent: 'Enviado',
    approved: 'Aprobado',
    scheduled: 'Programado'
  }[mapLegacyStatus(value)] || 'Sin iniciar';
}

function normalizeSubtask(subtask = {}) {
  const now = nowIso();
  return {
    id: subtask.id || generateId('st'),
    title: String(subtask.title || '').trim(),
    assigneeId: String(subtask.assigneeId || '').trim(),
    dueDate: normalizeDate(subtask.dueDate),
    status: mapLegacyStatus(subtask.status),
    deliverable: String(subtask.deliverable || '').trim(),
    createdAt: subtask.createdAt || now,
    updatedAt: subtask.updatedAt || now
  };
}

function getTaskAssigneeIds(task = {}) {
  const direct = uniqStrings(task.assigneeIds);
  if (direct.length) return direct;
  return uniqStrings([task.assigneeId]);
}

function normalizeResourceLink(link = {}) {
  const raw = typeof link === 'string' ? link : (link.url || '');
  const url = String(raw || '').trim();
  if (!url) return null;
  const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  let finalUrl = normalized;
  try {
    finalUrl = new URL(normalized).toString();
  } catch (_error) {}
  const provider = String((typeof link === 'object' && link.provider) || '').trim() || (() => {
    try {
      const host = new URL(finalUrl).hostname.toLowerCase();
      if (host.includes('canva.com')) return 'Canva';
      if (host.includes('drive.google.com') || host.includes('docs.google.com')) return 'Drive';
      if (host.includes('figma.com')) return 'Figma';
      if (host.includes('notion.so')) return 'Notion';
      return 'Link';
    } catch (_error) {
      return 'Link';
    }
  })();
  return {
    id: (typeof link === 'object' && link.id) || generateId('rl'),
    url: finalUrl,
    provider,
    label: String((typeof link === 'object' && (link.label || link.provider)) || provider).trim() || provider
  };
}

function normalizeTask(task) {
  const now = nowIso();
  const assigneeIds = getTaskAssigneeIds(task);
  return {
    id: task.id || generateId('t'),
    title: String(task.title || 'Nueva tarea').trim(),
    description: String(task.description || '').trim(),
    clientId: task.clientId || '',
    type: String(task.type || 'General').trim(),
    channel: String(task.channel || 'General').trim(),
    format: String(task.format || '').trim(),
    assigneeId: assigneeIds[0] || '',
    assigneeIds,
    priority: task.priority || 'Media',
    status: mapLegacyStatus(task.status),
    dueDate: normalizeDate(task.dueDate),
    publishDate: normalizeDate(task.publishDate),
    approvalRequired: Boolean(task.approvalRequired),
    labels: uniqStrings(task.labels),
    resourceLinks: normalizeArray(task.resourceLinks).map(normalizeResourceLink).filter(Boolean),
    checklist: normalizeArray(task.checklist).map((item) => ({
      id: item.id || generateId('cl'),
      text: String(item.text || '').trim(),
      done: Boolean(item.done)
    })).filter((item) => item.text),
    subtasks: normalizeArray(task.subtasks).map(normalizeSubtask).filter((item) => item.title),
    comments: normalizeArray(task.comments).map((item) => ({
      id: item.id || generateId('cm'),
      authorId: item.authorId || '',
      text: String(item.text || '').trim(),
      createdAt: item.createdAt || now
    })).filter((item) => item.text),
    createdById: task.createdById || '',
    createdAt: task.createdAt || now,
    updatedAt: task.updatedAt || now
  };
}

function normalizeClient(client) {
  const now = nowIso();
  return {
    id: client.id || generateId('c'),
    name: String(client.name || 'Nuevo cliente').trim(),
    handle: String(client.handle || '').trim(),
    service: String(client.service || '').trim(),
    plan: String(client.plan || '').trim(),
    status: client.status || 'Activo',
    ownerId: client.ownerId || '',
    channels: normalizeArray(client.channels).map((item) => String(item).trim()).filter(Boolean),
    notes: String(client.notes || '').trim(),
    createdAt: client.createdAt || now,
    updatedAt: taskOrClientUpdatedAt(client.updatedAt, now)
  };
}

function taskOrClientUpdatedAt(value, fallback) {
  return value || fallback;
}

function normalizeUser(user) {
  const now = nowIso();
  return {
    id: user.id || generateId('u'),
    name: String(user.name || 'Nuevo usuario').trim(),
    email: String(user.email || '').trim().toLowerCase(),
    role: user.role || 'Colaborador',
    accent: user.accent || 'default',
    status: user.status || 'active',
    passwordHash: user.passwordHash || '',
    createdAt: user.createdAt || now,
    updatedAt: user.updatedAt || now,
    lastLoginAt: user.lastLoginAt || ''
  };
}

function normalizeAttachment(attachment) {
  return {
    id: attachment.id || generateId('att'),
    taskId: attachment.taskId || '',
    originalName: attachment.originalName || 'archivo',
    storedName: attachment.storedName || '',
    mimeType: attachment.mimeType || 'application/octet-stream',
    sizeBytes: Number(attachment.sizeBytes || 0),
    uploadedById: attachment.uploadedById || '',
    createdAt: attachment.createdAt || nowIso()
  };
}

function normalizeEmailToken(token) {
  return {
    id: token.id || generateId('tok'),
    userId: token.userId || '',
    email: String(token.email || '').trim().toLowerCase(),
    type: token.type || TOKEN_TYPES.RESET,
    tokenHash: token.tokenHash || '',
    expiresAt: token.expiresAt || nowIso(),
    usedAt: token.usedAt || '',
    createdAt: token.createdAt || nowIso(),
    meta: token.meta || {}
  };
}

function normalizeEmailLog(log) {
  return {
    id: log.id || generateId('mail'),
    toEmail: String(log.toEmail || '').trim().toLowerCase(),
    subject: String(log.subject || '').trim(),
    textBody: String(log.textBody || '').trim(),
    htmlBody: String(log.htmlBody || '').trim(),
    mode: log.mode || 'log',
    previewLink: log.previewLink || '',
    createdAt: log.createdAt || nowIso()
  };
}

function defaultNotificationSettings() {
  return {
    enabled: process.env.REMINDER_ENABLED !== 'false',
    timezone: process.env.APP_TIMEZONE || 'America/Santo_Domingo',
    assignmentEmails: process.env.REMINDER_ASSIGNMENT_EMAILS !== 'false',
    dailyDigestEnabled: process.env.REMINDER_DAILY_DIGEST !== 'false',
    dailyDigestHour: Math.min(23, Math.max(0, Number(process.env.REMINDER_DIGEST_HOUR || 8))),
    dueSoonEnabled: process.env.REMINDER_DUE_SOON !== 'false',
    dueSoonHours: Math.max(1, Number(process.env.REMINDER_DUE_SOON_HOURS || 24)),
    overdueEnabled: process.env.REMINDER_OVERDUE !== 'false',
    overdueRepeatHours: Math.max(1, Number(process.env.REMINDER_OVERDUE_REPEAT_HOURS || 24)),
    weekendDigest: process.env.REMINDER_WEEKEND_DIGEST !== 'false',
    updatedAt: nowIso()
  };
}

function normalizeNotificationSettings(settings = {}) {
  const fallback = defaultNotificationSettings();
  return {
    enabled: settings.enabled ?? fallback.enabled,
    timezone: String(settings.timezone || fallback.timezone).trim() || fallback.timezone,
    assignmentEmails: settings.assignmentEmails ?? fallback.assignmentEmails,
    dailyDigestEnabled: settings.dailyDigestEnabled ?? fallback.dailyDigestEnabled,
    dailyDigestHour: Math.min(23, Math.max(0, Number(settings.dailyDigestHour ?? fallback.dailyDigestHour))),
    dueSoonEnabled: settings.dueSoonEnabled ?? fallback.dueSoonEnabled,
    dueSoonHours: Math.max(1, Number(settings.dueSoonHours ?? fallback.dueSoonHours)),
    overdueEnabled: settings.overdueEnabled ?? fallback.overdueEnabled,
    overdueRepeatHours: Math.max(1, Number(settings.overdueRepeatHours ?? fallback.overdueRepeatHours)),
    weekendDigest: settings.weekendDigest ?? fallback.weekendDigest,
    updatedAt: settings.updatedAt || fallback.updatedAt
  };
}

function normalizeReminderEvent(event = {}) {
  return {
    id: event.id || generateId('re'),
    kind: String(event.kind || 'generic').trim(),
    dedupeKey: String(event.dedupeKey || '').trim(),
    taskId: event.taskId || '',
    userId: event.userId || '',
    sentAt: event.sentAt || nowIso(),
    meta: event.meta || {},
    createdAt: event.createdAt || nowIso()
  };
}

function mapWorkStatus(value) {
  const normalized = String(value || '').trim().toLowerCase();
  const alias = {
    disponible: 'available',
    active: 'available',
    activo: 'available',
    enfocado: 'focus',
    foco: 'focus',
    focus: 'focus',
    meeting: 'meeting',
    reunion: 'meeting',
    reunión: 'meeting',
    pausa: 'break',
    descanso: 'break',
    break: 'break',
    offline: 'offline',
    desconectado: 'offline'
  };
  return ['available', 'focus', 'meeting', 'break', 'offline'].includes(normalized) ? normalized : (alias[normalized] || 'available');
}

function workStatusText(value) {
  return {
    available: 'Disponible',
    focus: 'En foco',
    meeting: 'En reunión',
    break: 'En pausa',
    offline: 'Desconectado'
  }[mapWorkStatus(value)] || 'Disponible';
}

function normalizeWorkSession(session = {}) {
  const now = nowIso();
  const dateKey = normalizeDate(session.dateKey || session.checkInAt || session.createdAt || new Date());
  return {
    id: session.id || generateId('ws'),
    userId: String(session.userId || '').trim(),
    dateKey,
    checkInAt: session.checkInAt || '',
    checkOutAt: session.checkOutAt || '',
    status: mapWorkStatus(session.status),
    focusPlan: String(session.focusPlan || '').trim(),
    endSummary: String(session.endSummary || '').trim(),
    blockers: String(session.blockers || '').trim(),
    createdAt: session.createdAt || now,
    updatedAt: session.updatedAt || now
  };
}

function normalizeActivityLog(log = {}) {
  return {
    id: log.id || generateId('act'),
    userId: String(log.userId || '').trim(),
    kind: String(log.kind || 'generic').trim(),
    label: String(log.label || '').trim() || 'Actividad registrada',
    entityType: String(log.entityType || '').trim(),
    entityId: String(log.entityId || '').trim(),
    meta: log.meta || {},
    createdAt: log.createdAt || nowIso()
  };
}

function todayDateKey() {
  return normalizeDate(new Date());
}

function defaultSeedData() {
  const currentTime = nowIso();
  const adminPassword = hashPassword(process.env.SEED_ADMIN_PASSWORD || 'ZiaFlow2026!');
  const adminEmail = process.env.SEED_ADMIN_EMAIL || process.env.SMTP_USER || 'admin@zialab.com';
  return {
    brand: { name: 'Zia WorkSpace', subtitle: 'Zia Lab Agency' },
    users: [
      { id: 'u1', name: 'Zia', email: adminEmail, role: 'Admin', accent: 'admin', status: 'active', passwordHash: adminPassword, createdAt: currentTime, updatedAt: currentTime, lastLoginAt: '' },
      { id: 'u2', name: 'Emely', email: 'emely@agency.local', role: 'Content Manager', accent: 'content', status: 'active', passwordHash: adminPassword, createdAt: currentTime, updatedAt: currentTime, lastLoginAt: '' },
      { id: 'u3', name: 'Franny', email: 'franny@agency.local', role: 'Designer', accent: 'design', status: 'active', passwordHash: adminPassword, createdAt: currentTime, updatedAt: currentTime, lastLoginAt: '' },
      { id: 'u4', name: 'Jhofrankny', email: 'jh@agency.local', role: 'Developer', accent: 'dev', status: 'active', passwordHash: adminPassword, createdAt: currentTime, updatedAt: currentTime, lastLoginAt: '' },
      { id: 'u5', name: 'Andrea', email: 'andrea@agency.local', role: 'Video Editor', accent: 'video', status: 'active', passwordHash: adminPassword, createdAt: currentTime, updatedAt: currentTime, lastLoginAt: '' }
    ],
    clients: [
      { id: 'c1', name: 'Terramarine', handle: '@terramarine.rd', service: 'Gestión de redes + campañas', plan: 'Mensual', status: 'Activo', ownerId: 'u2', channels: ['Instagram', 'Facebook', 'TikTok'], notes: 'Enfoque en paquetes y experiencias premium.', createdAt: currentTime, updatedAt: currentTime },
      { id: 'c2', name: 'Eves Dental Studio', handle: '@evesdentalstudio', service: 'Contenido + diseño', plan: 'Mensual', status: 'Activo', ownerId: 'u3', channels: ['Instagram', 'Facebook'], notes: 'Contenido educativo y testimoniales.', createdAt: currentTime, updatedAt: currentTime },
      { id: 'c3', name: 'Oso Pack Courier', handle: '@osopackrd', service: 'Contenido + promociones', plan: 'Mensual', status: 'Activo', ownerId: 'u2', channels: ['Instagram', 'Facebook', 'WhatsApp'], notes: 'Mantener línea visual clara y tono confiable.', createdAt: currentTime, updatedAt: currentTime },
      { id: 'c4', name: 'TekkoCode', handle: '@tekkocode', service: 'Branding + captación', plan: 'Interno', status: 'Interno', ownerId: 'u1', channels: ['Instagram', 'LinkedIn', 'Website'], notes: 'Generar leads de desarrollo web y automatizaciones.', createdAt: currentTime, updatedAt: currentTime }
    ],
    tasks: [
      { id: 't1', title: 'Reel promo Semana Santa', description: 'Crear idea, guion corto y edición para paquete de fin de semana.', clientId: 'c1', type: 'Reel', channel: 'Instagram', format: 'Vertical 9:16', assigneeIds: ['u2', 'u5'], priority: 'Alta', status: 'in_progress', dueDate: '2026-04-21', publishDate: '2026-04-22', approvalRequired: true, labels: ['venta', 'video'], checklist: [{ id: 'cl1', text: 'Hook del video', done: true }, { id: 'cl2', text: 'Edición y subtítulos', done: false }, { id: 'cl3', text: 'Portada', done: false }], subtasks: [{ id: 'st1', title: 'Guion corto', assigneeId: 'u2', dueDate: '2026-04-20', status: 'review', deliverable: 'Copy final' }, { id: 'st2', title: 'Edición vertical', assigneeId: 'u5', dueDate: '2026-04-21', status: 'in_progress', deliverable: 'Video con subtítulos' }], comments: [{ id: 'cm1', authorId: 'u2', text: 'Usar enfoque más aspiracional y premium.', createdAt: currentTime }], createdById: 'u1', createdAt: currentTime, updatedAt: currentTime },
      { id: 't2', title: 'Calendario mensual Eves Dental', description: 'Definir contenido del mes, copies y artes listos para aprobación.', clientId: 'c2', type: 'Calendario', channel: 'Instagram', format: 'Mensual', assigneeIds: ['u2', 'u3'], priority: 'Alta', status: 'review', dueDate: '2026-04-24', publishDate: '2026-04-25', approvalRequired: true, labels: ['calendario', 'contenido'], checklist: [{ id: 'cl4', text: 'Propuesta de temas', done: true }, { id: 'cl5', text: 'Diseño base del feed', done: false }], subtasks: [{ id: 'st3', title: 'Ideas y copies del mes', assigneeId: 'u2', dueDate: '2026-04-22', status: 'review', deliverable: 'Documento de copies' }, { id: 'st4', title: 'Línea visual del calendario', assigneeId: 'u3', dueDate: '2026-04-23', status: 'in_progress', deliverable: 'Artes en Canva/Figma' }], comments: [{ id: 'cm2', authorId: 'u1', text: 'Mantener tono educativo y comercial balanceado.', createdAt: currentTime }], createdById: 'u1', createdAt: currentTime, updatedAt: currentTime },
      { id: 't3', title: 'Historias promo de libras', description: 'Set de 4 stories con foco en rapidez y precio por libra.', clientId: 'c3', type: 'Stories', channel: 'Instagram', format: '1080x1920', assigneeIds: ['u2'], priority: 'Alta', status: 'not_started', dueDate: '2026-04-20', publishDate: '2026-04-20', approvalRequired: false, labels: ['stories', 'promo'], checklist: [{ id: 'cl6', text: 'Copy inicial', done: false }, { id: 'cl7', text: 'Idea visual', done: false }], subtasks: [], comments: [], createdById: 'u1', createdAt: currentTime, updatedAt: currentTime },
      { id: 't4', title: 'Landing captación TekkoCode', description: 'Actualizar hero, CTA y casos de uso para agencias y eCommerce.', clientId: 'c4', type: 'Web', channel: 'Website', format: 'Landing', assigneeIds: ['u4'], priority: 'Alta', status: 'in_progress', dueDate: '2026-04-25', publishDate: '2026-04-26', approvalRequired: true, labels: ['dev', 'captación'], checklist: [{ id: 'cl8', text: 'Nuevo layout', done: true }, { id: 'cl9', text: 'Formulario conectado', done: false }], subtasks: [], comments: [], createdById: 'u1', createdAt: currentTime, updatedAt: currentTime }
    ],
    attachments: [],
    sessions: [],
    emailTokens: [],
    emailLogs: [],
    workSessions: [
      { id: 'ws1', userId: 'u2', dateKey: todayDateKey(), checkInAt: currentTime, checkOutAt: '', status: 'focus', focusPlan: 'Completar copies del calendario y revisar captions de promociones.', endSummary: '', blockers: '', createdAt: currentTime, updatedAt: currentTime },
      { id: 'ws2', userId: 'u3', dateKey: todayDateKey(), checkInAt: currentTime, checkOutAt: '', status: 'available', focusPlan: 'Diseñar piezas del calendario y propuesta visual de cliente dental.', endSummary: '', blockers: '', createdAt: currentTime, updatedAt: currentTime }
    ],
    activityLogs: [
      { id: 'act1', userId: 'u2', kind: 'session', label: 'Inició su jornada remota.', entityType: 'work_session', entityId: 'ws1', meta: { source: 'seed' }, createdAt: currentTime },
      { id: 'act2', userId: 'u3', kind: 'session', label: 'Actualizó su plan del día.', entityType: 'work_session', entityId: 'ws2', meta: { source: 'seed' }, createdAt: currentTime }
    ],
    notificationSettings: defaultNotificationSettings(),
    reminderEvents: []
  };
}

function loadSeedData() {
  const fallback = defaultSeedData();
  if (!fs.existsSync(DB_FILE)) return fallback;
  try {
    const existing = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    return {
      brand: existing.brand || fallback.brand,
      users: normalizeArray(existing.users).length ? existing.users.map(normalizeUser) : fallback.users,
      clients: normalizeArray(existing.clients).length ? existing.clients.map(normalizeClient) : fallback.clients,
      tasks: normalizeArray(existing.tasks).length ? existing.tasks.map(normalizeTask) : fallback.tasks,
      attachments: normalizeArray(existing.attachments).map(normalizeAttachment),
      sessions: normalizeArray(existing.sessions),
      emailTokens: normalizeArray(existing.emailTokens).map(normalizeEmailToken),
      emailLogs: normalizeArray(existing.emailLogs).map(normalizeEmailLog),
      workSessions: normalizeArray(existing.workSessions).map(normalizeWorkSession),
      activityLogs: normalizeArray(existing.activityLogs).map(normalizeActivityLog),
      notificationSettings: normalizeNotificationSettings(existing.notificationSettings || fallback.notificationSettings),
      reminderEvents: normalizeArray(existing.reminderEvents).map(normalizeReminderEvent)
    };
  } catch (error) {
    console.error('No se pudo leer data/db.json, usando semilla por defecto:', error.message);
    return fallback;
  }
}

function createFileAdapter() {
  function readDb() {
    const data = loadSeedData();
    writeDb(data);
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  }

  function writeDb(db) {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  }

  function cleanup(db) {
    const now = Date.now();
    const demoPassword = process.env.SEED_ADMIN_PASSWORD || 'ZiaFlow2026!';
    db.sessions = normalizeArray(db.sessions).filter((session) => new Date(session.expiresAt).getTime() > now);
    db.emailTokens = normalizeArray(db.emailTokens).filter((token) => !token.usedAt && new Date(token.expiresAt).getTime() > now);
    db.users = normalizeArray(db.users).map((user) => {
      const normalized = normalizeUser(user);
      if (normalized.email.endsWith('@agency.local') && !verifyPassword(demoPassword, normalized.passwordHash || '')) {
        normalized.passwordHash = hashPassword(demoPassword);
        normalized.updatedAt = nowIso();
      }
      return normalized;
    });
    db.notificationSettings = normalizeNotificationSettings(db.notificationSettings);
    db.workSessions = normalizeArray(db.workSessions)
      .map(normalizeWorkSession)
      .filter((session) => new Date(`${session.dateKey}T00:00:00`).getTime() > now - (1000 * 60 * 60 * 24 * 60));
    db.activityLogs = normalizeArray(db.activityLogs)
      .map(normalizeActivityLog)
      .filter((item) => new Date(item.createdAt).getTime() > now - (1000 * 60 * 60 * 24 * 45))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 500);
    db.reminderEvents = normalizeArray(db.reminderEvents)
      .map(normalizeReminderEvent)
      .filter((event) => new Date(event.sentAt || event.createdAt).getTime() > now - (1000 * 60 * 60 * 24 * 120));
    return db;
  }

  function listVisibleWorkSessions(db, currentUser) {
    const sessions = normalizeArray(db.workSessions).map(normalizeWorkSession).sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
    return currentUser?.role === 'Admin' ? sessions.slice(0, 120) : sessions.filter((item) => item.userId === currentUser?.id).slice(0, 30);
  }

  function listVisibleActivityLogs(db, currentUser) {
    const logs = normalizeArray(db.activityLogs).map(normalizeActivityLog).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return currentUser?.role === 'Admin' ? logs.slice(0, 120) : logs.filter((item) => item.userId === currentUser?.id).slice(0, 40);
  }

  function decorateTasks(db) {
    const attachmentsByTask = new Map();
    normalizeArray(db.attachments).forEach((attachment) => {
      const list = attachmentsByTask.get(attachment.taskId) || [];
      list.push(attachment);
      attachmentsByTask.set(attachment.taskId, list);
    });
    return normalizeArray(db.tasks).map((task) => ({
      ...normalizeTask(task),
      attachments: (attachmentsByTask.get(task.id) || []).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    }));
  }

  return {
    kind: 'file',
    async init() {
      const seeded = cleanup(loadSeedData());
      writeDb(seeded);
    },
    async getBrand() {
      return readDb().brand;
    },
    async getBootstrap(currentUser) {
      const db = cleanup(readDb());
      writeDb(db);
      const tasks = decorateTasks(db).sort((a, b) => {
        const aIndex = STATUS_ORDER.indexOf(a.status);
        const bIndex = STATUS_ORDER.indexOf(b.status);
        if (aIndex !== bIndex) return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex);
        return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
      });
      return {
        brand: db.brand,
        currentUser: sanitizeUser(currentUser),
        users: db.users.map(sanitizeUser),
        clients: db.clients,
        tasks,
        emailLogs: currentUser.role === 'Admin' ? db.emailLogs.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 25) : [],
        workSessions: listVisibleWorkSessions(db, currentUser),
        activityLogs: listVisibleActivityLogs(db, currentUser),
        notificationSettings: normalizeNotificationSettings(db.notificationSettings)
      };
    },
    async findUserByEmail(email) {
      const db = readDb();
      return db.users.find((user) => user.email === String(email).toLowerCase()) || null;
    },
    async getUserById(userId) {
      const db = readDb();
      return db.users.find((user) => user.id === userId) || null;
    },
    async listUsers() {
      return readDb().users.map(sanitizeUser);
    },
    async createUser(payload) {
      const db = readDb();
      const user = normalizeUser(payload);
      db.users.push(user);
      writeDb(db);
      return sanitizeUser(user);
    },
    async updateUser(userId, payload) {
      const db = readDb();
      const index = db.users.findIndex((user) => user.id === userId);
      if (index === -1) return null;
      const merged = normalizeUser({ ...db.users[index], ...payload, id: userId, updatedAt: nowIso() });
      db.users[index] = merged;
      writeDb(db);
      return sanitizeUser(merged);
    },
    async setUserPassword(userId, password) {
      const db = readDb();
      const index = db.users.findIndex((user) => user.id === userId);
      if (index === -1) return null;
      db.users[index] = normalizeUser({
        ...db.users[index],
        passwordHash: hashPassword(password),
        status: 'active',
        updatedAt: nowIso()
      });
      writeDb(db);
      return sanitizeUser(db.users[index]);
    },
    async createSession(userId) {
      const db = readDb();
      const rawToken = crypto.randomBytes(32).toString('hex');
      db.sessions.push({
        id: generateId('s'),
        userId,
        tokenHash: sha256(rawToken),
        createdAt: nowIso(),
        expiresAt: new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString()
      });
      writeDb(db);
      return rawToken;
    },
    async getUserBySessionToken(rawToken) {
      if (!rawToken) return null;
      const db = cleanup(readDb());
      writeDb(db);
      const session = db.sessions.find((item) => item.tokenHash === sha256(rawToken));
      if (!session) return null;
      return db.users.find((user) => user.id === session.userId) || null;
    },
    async deleteSession(rawToken) {
      const db = readDb();
      db.sessions = db.sessions.filter((item) => item.tokenHash !== sha256(rawToken));
      writeDb(db);
    },
    async saveClient(payload) {
      const db = readDb();
      if (payload.id) {
        const index = db.clients.findIndex((client) => client.id === payload.id);
        if (index === -1) return null;
        db.clients[index] = normalizeClient({ ...db.clients[index], ...payload, updatedAt: nowIso() });
        writeDb(db);
        return db.clients[index];
      }
      const client = normalizeClient(payload);
      db.clients.unshift(client);
      writeDb(db);
      return client;
    },
    async deleteClient(clientId) {
      const db = readDb();
      if (db.tasks.some((task) => task.clientId === clientId)) {
        return { ok: false, code: 'CLIENT_HAS_TASKS' };
      }
      const nextClients = db.clients.filter((client) => client.id !== clientId);
      if (nextClients.length === db.clients.length) return { ok: false, code: 'NOT_FOUND' };
      db.clients = nextClients;
      writeDb(db);
      return { ok: true };
    },
    async saveTask(payload) {
      const db = readDb();
      if (payload.id) {
        const index = db.tasks.findIndex((task) => task.id === payload.id);
        if (index === -1) return null;
        const merged = normalizeTask({ ...db.tasks[index], ...payload, id: payload.id, updatedAt: nowIso() });
        db.tasks[index] = merged;
        writeDb(db);
        return { ...merged, attachments: db.attachments.filter((item) => item.taskId === merged.id) };
      }
      const task = normalizeTask(payload);
      db.tasks.unshift(task);
      writeDb(db);
      return { ...task, attachments: [] };
    },
    async deleteTask(taskId) {
      const db = readDb();
      const exists = db.tasks.some((task) => task.id === taskId);
      if (!exists) return { ok: false, code: 'NOT_FOUND' };
      const attachments = db.attachments.filter((item) => item.taskId === taskId);
      attachments.forEach((item) => {
        const filePath = path.join(UPLOADS_DIR, item.storedName);
        if (item.storedName && fs.existsSync(filePath)) fs.unlinkSync(filePath);
      });
      db.attachments = db.attachments.filter((item) => item.taskId !== taskId);
      db.tasks = db.tasks.filter((task) => task.id !== taskId);
      writeDb(db);
      return { ok: true };
    },
    async createAttachment(taskId, file, uploadedById) {
      const db = readDb();
      const attachment = normalizeAttachment({
        taskId,
        originalName: file.originalname,
        storedName: file.filename,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        uploadedById
      });
      db.attachments.unshift(attachment);
      writeDb(db);
      return attachment;
    },
    async getAttachment(attachmentId) {
      const db = readDb();
      return db.attachments.find((item) => item.id === attachmentId) || null;
    },
    async deleteAttachment(attachmentId) {
      const db = readDb();
      const attachment = db.attachments.find((item) => item.id === attachmentId);
      if (!attachment) return { ok: false, code: 'NOT_FOUND' };
      db.attachments = db.attachments.filter((item) => item.id !== attachmentId);
      writeDb(db);
      const filePath = path.join(UPLOADS_DIR, attachment.storedName);
      if (attachment.storedName && fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return { ok: true, attachment };
    },
    async getNotificationSettings() {
      const db = cleanup(readDb());
      writeDb(db);
      return normalizeNotificationSettings(db.notificationSettings);
    },
    async saveNotificationSettings(payload) {
      const db = cleanup(readDb());
      db.notificationSettings = normalizeNotificationSettings({ ...db.notificationSettings, ...payload, updatedAt: nowIso() });
      writeDb(db);
      return db.notificationSettings;
    },
    async findReminderEvent(dedupeKey) {
      const db = cleanup(readDb());
      writeDb(db);
      return db.reminderEvents.find((item) => item.dedupeKey === dedupeKey) || null;
    },
    async createReminderEvent(payload) {
      const db = cleanup(readDb());
      const event = normalizeReminderEvent(payload);
      db.reminderEvents.unshift(event);
      writeDb(db);
      return event;
    },
    async getWorkSessionForDate(userId, dateKey = todayDateKey()) {
      const db = cleanup(readDb());
      writeDb(db);
      const session = normalizeArray(db.workSessions).map(normalizeWorkSession).find((item) => item.userId === userId && item.dateKey === dateKey);
      return session || null;
    },
    async saveWorkSession(payload) {
      const db = cleanup(readDb());
      const existingIndex = normalizeArray(db.workSessions).findIndex((item) => item.id === payload.id || (item.userId === payload.userId && normalizeDate(item.dateKey) === normalizeDate(payload.dateKey)));
      const base = existingIndex >= 0 ? normalizeWorkSession(db.workSessions[existingIndex]) : null;
      const session = normalizeWorkSession({ ...base, ...payload, id: base?.id || payload.id, updatedAt: nowIso() });
      if (existingIndex >= 0) {
        db.workSessions[existingIndex] = session;
      } else {
        db.workSessions.unshift(session);
      }
      writeDb(db);
      return session;
    },
    async listActivityLogs({ userId = '', limit = 50 } = {}) {
      const db = cleanup(readDb());
      writeDb(db);
      let logs = normalizeArray(db.activityLogs).map(normalizeActivityLog).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      if (userId) logs = logs.filter((item) => item.userId === userId);
      return logs.slice(0, limit);
    },
    async createActivityLog(payload) {
      const db = cleanup(readDb());
      const log = normalizeActivityLog(payload);
      db.activityLogs.unshift(log);
      db.activityLogs = db.activityLogs.slice(0, 500);
      writeDb(db);
      return log;
    },
    async createEmailToken({ userId, email, type, expiresHours = 24, meta = {} }) {
      const db = readDb();
      const rawToken = crypto.randomBytes(32).toString('hex');
      const token = normalizeEmailToken({
        userId,
        email,
        type,
        tokenHash: sha256(rawToken),
        expiresAt: new Date(Date.now() + expiresHours * 60 * 60 * 1000).toISOString(),
        meta
      });
      db.emailTokens = db.emailTokens.filter((item) => !(item.userId === userId && item.type === type && !item.usedAt));
      db.emailTokens.unshift(token);
      writeDb(db);
      return { rawToken, token };
    },
    async getValidToken(rawToken) {
      const db = cleanup(readDb());
      writeDb(db);
      const token = db.emailTokens.find((item) => item.tokenHash === sha256(rawToken));
      if (!token || token.usedAt) return null;
      if (new Date(token.expiresAt).getTime() <= Date.now()) return null;
      const user = db.users.find((item) => item.id === token.userId) || null;
      return { token, user };
    },
    async useToken(rawToken) {
      const db = readDb();
      const index = db.emailTokens.findIndex((item) => item.tokenHash === sha256(rawToken));
      if (index === -1) return null;
      db.emailTokens[index].usedAt = nowIso();
      writeDb(db);
      return db.emailTokens[index];
    },
    async logEmail(payload) {
      const db = readDb();
      const log = normalizeEmailLog(payload);
      db.emailLogs.unshift(log);
      writeDb(db);
      return log;
    }
  };
}

function createPostgresAdapter() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined
  });

  async function query(text, params = []) {
    return pool.query(text, params);
  }

  async function getTasksWithAttachments() {
    const tasksRes = await query('SELECT * FROM tasks ORDER BY updated_at DESC');
    const attachmentsRes = await query('SELECT * FROM attachments ORDER BY created_at DESC');
    const attachmentsByTask = new Map();
    attachmentsRes.rows.forEach((row) => {
      const item = mapAttachmentRow(row);
      const list = attachmentsByTask.get(item.taskId) || [];
      list.push(item);
      attachmentsByTask.set(item.taskId, list);
    });
    return tasksRes.rows.map((row) => {
      const task = mapTaskRow(row);
      task.attachments = attachmentsByTask.get(task.id) || [];
      return task;
    }).sort((a, b) => {
      const aIndex = STATUS_ORDER.indexOf(a.status);
      const bIndex = STATUS_ORDER.indexOf(b.status);
      if (aIndex !== bIndex) return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex);
      return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
    });
  }

  async function seedIfNeeded() {
    const usersCount = await query('SELECT COUNT(*)::int AS count FROM users');
    if (usersCount.rows[0].count > 0) return;
    const seed = loadSeedData();
    for (const user of seed.users.map(normalizeUser)) {
      await query(
        `INSERT INTO users (id, name, email, role, accent, status, password_hash, created_at, updated_at, last_login_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [user.id, user.name, user.email, user.role, user.accent, user.status, user.passwordHash, user.createdAt, user.updatedAt, user.lastLoginAt || null]
      );
    }
    for (const client of seed.clients.map(normalizeClient)) {
      await query(
        `INSERT INTO clients (id, name, handle, service, plan, status, owner_id, channels, notes, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11)`,
        [client.id, client.name, client.handle, client.service, client.plan, client.status, client.ownerId || null, JSON.stringify(client.channels), client.notes, client.createdAt, client.updatedAt]
      );
    }
    for (const task of seed.tasks.map(normalizeTask)) {
      await query(
        `INSERT INTO tasks (id, title, description, client_id, type, channel, format, assignee_id, assignee_ids, priority, status, due_date, publish_date, approval_required, resource_links, labels, checklist, subtasks, comments, created_by_id, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,$17::jsonb,$18::jsonb,$19::jsonb,$20,$21,$22)`,
        [task.id, task.title, task.description, task.clientId || null, task.type, task.channel, task.format, task.assigneeId || null, JSON.stringify(task.assigneeIds || []), task.priority, task.status, task.dueDate || null, task.publishDate || null, task.approvalRequired, JSON.stringify(task.resourceLinks || []), JSON.stringify(task.labels), JSON.stringify(task.checklist), JSON.stringify(task.subtasks || []), JSON.stringify(task.comments), task.createdById || null, task.createdAt, task.updatedAt]
      );
    }
    for (const session of seed.workSessions.map(normalizeWorkSession)) {
      await query(
        `INSERT INTO work_sessions (id, user_id, date_key, check_in_at, check_out_at, status, focus_plan, end_summary, blockers, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (user_id, date_key) DO NOTHING`,
        [session.id, session.userId, session.dateKey, session.checkInAt || null, session.checkOutAt || null, session.status, session.focusPlan, session.endSummary, session.blockers, session.createdAt, session.updatedAt]
      );
    }
    for (const log of seed.activityLogs.map(normalizeActivityLog)) {
      await query(
        `INSERT INTO activity_logs (id, user_id, kind, label, entity_type, entity_id, meta, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
        [log.id, log.userId || null, log.kind, log.label, log.entityType || null, log.entityId || null, JSON.stringify(log.meta || {}), log.createdAt]
      );
    }
  }

  function mapUserRow(row) {
    return normalizeUser({
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      accent: row.accent,
      status: row.status,
      passwordHash: row.password_hash,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastLoginAt: row.last_login_at || ''
    });
  }

  function mapClientRow(row) {
    return normalizeClient({
      id: row.id,
      name: row.name,
      handle: row.handle,
      service: row.service,
      plan: row.plan,
      status: row.status,
      ownerId: row.owner_id || '',
      channels: row.channels || [],
      notes: row.notes,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    });
  }

  function mapTaskRow(row) {
    return normalizeTask({
      id: row.id,
      title: row.title,
      description: row.description,
      clientId: row.client_id || '',
      type: row.type,
      channel: row.channel,
      format: row.format,
      assigneeId: row.assignee_id || '',
      assigneeIds: row.assignee_ids || [],
      priority: row.priority,
      status: row.status,
      dueDate: row.due_date,
      publishDate: row.publish_date,
      approvalRequired: row.approval_required,
      labels: row.labels || [],
      checklist: row.checklist || [],
      subtasks: row.subtasks || [],
      resourceLinks: row.resource_links || [],
      comments: row.comments || [],
      createdById: row.created_by_id || '',
      createdAt: row.created_at,
      updatedAt: row.updated_at
    });
  }

  function mapAttachmentRow(row) {
    return normalizeAttachment({
      id: row.id,
      taskId: row.task_id,
      originalName: row.original_name,
      storedName: row.stored_name,
      mimeType: row.mime_type,
      sizeBytes: row.size_bytes,
      uploadedById: row.uploaded_by_id || '',
      createdAt: row.created_at
    });
  }


  function mapWorkSessionRow(row) {
    return normalizeWorkSession({
      id: row.id,
      userId: row.user_id,
      dateKey: row.date_key,
      checkInAt: row.check_in_at || '',
      checkOutAt: row.check_out_at || '',
      status: row.status,
      focusPlan: row.focus_plan || '',
      endSummary: row.end_summary || '',
      blockers: row.blockers || '',
      createdAt: row.created_at,
      updatedAt: row.updated_at
    });
  }

  function mapActivityLogRow(row) {
    return normalizeActivityLog({
      id: row.id,
      userId: row.user_id || '',
      kind: row.kind,
      label: row.label,
      entityType: row.entity_type || '',
      entityId: row.entity_id || '',
      meta: row.meta || {},
      createdAt: row.created_at
    });
  }

  return {
    kind: 'postgres',
    async init() {
      await query(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT NOT NULL UNIQUE,
          role TEXT NOT NULL,
          accent TEXT NOT NULL,
          status TEXT NOT NULL,
          password_hash TEXT,
          created_at TIMESTAMPTZ NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL,
          last_login_at TIMESTAMPTZ
        );
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token_hash TEXT NOT NULL UNIQUE,
          created_at TIMESTAMPTZ NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL
        );
        CREATE TABLE IF NOT EXISTS clients (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          handle TEXT,
          service TEXT,
          plan TEXT,
          status TEXT NOT NULL,
          owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          channels JSONB NOT NULL DEFAULT '[]'::jsonb,
          notes TEXT,
          created_at TIMESTAMPTZ NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL
        );
        CREATE TABLE IF NOT EXISTS tasks (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          description TEXT,
          client_id TEXT REFERENCES clients(id) ON DELETE SET NULL,
          type TEXT NOT NULL,
          channel TEXT NOT NULL,
          format TEXT,
          assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          assignee_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
          priority TEXT NOT NULL,
          status TEXT NOT NULL,
          due_date DATE,
          publish_date DATE,
          approval_required BOOLEAN NOT NULL DEFAULT FALSE,
          resource_links JSONB NOT NULL DEFAULT '[]'::jsonb,
          labels JSONB NOT NULL DEFAULT '[]'::jsonb,
          checklist JSONB NOT NULL DEFAULT '[]'::jsonb,
          subtasks JSONB NOT NULL DEFAULT '[]'::jsonb,
          comments JSONB NOT NULL DEFAULT '[]'::jsonb,
          created_by_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL
        );
        CREATE TABLE IF NOT EXISTS attachments (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          original_name TEXT NOT NULL,
          stored_name TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          size_bytes INTEGER NOT NULL,
          uploaded_by_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL
        );
        CREATE TABLE IF NOT EXISTS email_tokens (
          id TEXT PRIMARY KEY,
          user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
          email TEXT NOT NULL,
          type TEXT NOT NULL,
          token_hash TEXT NOT NULL UNIQUE,
          expires_at TIMESTAMPTZ NOT NULL,
          used_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL,
          meta JSONB NOT NULL DEFAULT '{}'::jsonb
        );
        CREATE TABLE IF NOT EXISTS email_logs (
          id TEXT PRIMARY KEY,
          to_email TEXT NOT NULL,
          subject TEXT NOT NULL,
          text_body TEXT,
          html_body TEXT,
          mode TEXT NOT NULL,
          preview_link TEXT,
          created_at TIMESTAMPTZ NOT NULL
        );
        CREATE TABLE IF NOT EXISTS work_sessions (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          date_key DATE NOT NULL,
          check_in_at TIMESTAMPTZ,
          check_out_at TIMESTAMPTZ,
          status TEXT NOT NULL,
          focus_plan TEXT,
          end_summary TEXT,
          blockers TEXT,
          created_at TIMESTAMPTZ NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL,
          UNIQUE(user_id, date_key)
        );
        CREATE TABLE IF NOT EXISTS activity_logs (
          id TEXT PRIMARY KEY,
          user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          kind TEXT NOT NULL,
          label TEXT NOT NULL,
          entity_type TEXT,
          entity_id TEXT,
          meta JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL
        );
        CREATE TABLE IF NOT EXISTS notification_settings (
          id TEXT PRIMARY KEY,
          settings JSONB NOT NULL DEFAULT '{}'::jsonb,
          updated_at TIMESTAMPTZ NOT NULL
        );
        CREATE TABLE IF NOT EXISTS reminder_events (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          dedupe_key TEXT NOT NULL UNIQUE,
          task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
          user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          sent_at TIMESTAMPTZ NOT NULL,
          meta JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL
        );
      `);
      await query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assignee_ids JSONB NOT NULL DEFAULT '[]'::jsonb`);
      await query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS subtasks JSONB NOT NULL DEFAULT '[]'::jsonb`);
      await query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS resource_links JSONB NOT NULL DEFAULT '[]'::jsonb`);
      await query(`UPDATE tasks SET assignee_ids = CASE WHEN assignee_id IS NULL OR assignee_id = '' THEN '[]'::jsonb ELSE jsonb_build_array(assignee_id) END WHERE assignee_ids IS NULL OR assignee_ids = '[]'::jsonb`);
      await seedIfNeeded();
      await query('DELETE FROM sessions WHERE expires_at <= NOW()');
      await query('DELETE FROM email_tokens WHERE used_at IS NOT NULL OR expires_at <= NOW()');
    },
    async getBrand() {
      return loadSeedData().brand;
    },
    async getBootstrap(currentUser) {
      const [usersRes, clientsRes, emailLogsRes] = await Promise.all([
        query('SELECT * FROM users ORDER BY name ASC'),
        query('SELECT * FROM clients ORDER BY name ASC'),
        currentUser.role === 'Admin' ? query('SELECT * FROM email_logs ORDER BY created_at DESC LIMIT 25') : Promise.resolve({ rows: [] })
      ]);
      const workSessionsRes = await query(
        currentUser.role === 'Admin'
          ? 'SELECT * FROM work_sessions ORDER BY updated_at DESC LIMIT 120'
          : 'SELECT * FROM work_sessions WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 30',
        currentUser.role === 'Admin' ? [] : [currentUser.id]
      );
      const activityLogsRes = await query(
        currentUser.role === 'Admin'
          ? 'SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT 120'
          : 'SELECT * FROM activity_logs WHERE user_id = $1 ORDER BY created_at DESC LIMIT 40',
        currentUser.role === 'Admin' ? [] : [currentUser.id]
      );
      return {
        brand: loadSeedData().brand,
        currentUser: sanitizeUser(currentUser),
        users: usersRes.rows.map(mapUserRow).map(sanitizeUser),
        clients: clientsRes.rows.map(mapClientRow),
        tasks: await getTasksWithAttachments(),
        emailLogs: emailLogsRes.rows.map((row) => normalizeEmailLog({
          id: row.id,
          toEmail: row.to_email,
          subject: row.subject,
          textBody: row.text_body,
          htmlBody: row.html_body,
          mode: row.mode,
          previewLink: row.preview_link,
          createdAt: row.created_at
        })),
        workSessions: workSessionsRes.rows.map(mapWorkSessionRow),
        activityLogs: activityLogsRes.rows.map(mapActivityLogRow),
        notificationSettings: await this.getNotificationSettings()
      };
    },
    async findUserByEmail(email) {
      const res = await query('SELECT * FROM users WHERE email = $1 LIMIT 1', [String(email).toLowerCase()]);
      return res.rows[0] ? mapUserRow(res.rows[0]) : null;
    },
    async getUserById(userId) {
      const res = await query('SELECT * FROM users WHERE id = $1 LIMIT 1', [userId]);
      return res.rows[0] ? mapUserRow(res.rows[0]) : null;
    },
    async listUsers() {
      const res = await query('SELECT * FROM users ORDER BY name ASC');
      return res.rows.map(mapUserRow).map(sanitizeUser);
    },
    async createUser(payload) {
      const user = normalizeUser(payload);
      await query(
        `INSERT INTO users (id, name, email, role, accent, status, password_hash, created_at, updated_at, last_login_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [user.id, user.name, user.email, user.role, user.accent, user.status, user.passwordHash || null, user.createdAt, user.updatedAt, user.lastLoginAt || null]
      );
      return sanitizeUser(user);
    },
    async updateUser(userId, payload) {
      const current = await this.getUserById(userId);
      if (!current) return null;
      const merged = normalizeUser({ ...current, ...payload, id: userId, passwordHash: payload.passwordHash || current.passwordHash, updatedAt: nowIso() });
      await query(
        `UPDATE users SET name=$2, email=$3, role=$4, accent=$5, status=$6, password_hash=$7, updated_at=$8, last_login_at=$9 WHERE id=$1`,
        [userId, merged.name, merged.email, merged.role, merged.accent, merged.status, merged.passwordHash || null, merged.updatedAt, merged.lastLoginAt || null]
      );
      return sanitizeUser(merged);
    },
    async setUserPassword(userId, password) {
      const passwordHash = hashPassword(password);
      await query('UPDATE users SET password_hash=$2, status=$3, updated_at=$4 WHERE id=$1', [userId, passwordHash, 'active', nowIso()]);
      return this.getUserById(userId).then(sanitizeUser);
    },
    async createSession(userId) {
      const rawToken = crypto.randomBytes(32).toString('hex');
      await query(
        'INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES ($1,$2,$3,$4,$5)',
        [generateId('s'), userId, sha256(rawToken), nowIso(), new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString()]
      );
      return rawToken;
    },
    async getUserBySessionToken(rawToken) {
      if (!rawToken) return null;
      const res = await query(
        `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > NOW() LIMIT 1`,
        [sha256(rawToken)]
      );
      return res.rows[0] ? mapUserRow(res.rows[0]) : null;
    },
    async deleteSession(rawToken) {
      await query('DELETE FROM sessions WHERE token_hash = $1', [sha256(rawToken)]);
    },
    async saveClient(payload) {
      if (payload.id) {
        const currentRes = await query('SELECT * FROM clients WHERE id=$1 LIMIT 1', [payload.id]);
        if (!currentRes.rows[0]) return null;
        const merged = normalizeClient({ ...mapClientRow(currentRes.rows[0]), ...payload, id: payload.id, updatedAt: nowIso() });
        await query(
          `UPDATE clients SET name=$2, handle=$3, service=$4, plan=$5, status=$6, owner_id=$7, channels=$8::jsonb, notes=$9, updated_at=$10 WHERE id=$1`,
          [merged.id, merged.name, merged.handle, merged.service, merged.plan, merged.status, merged.ownerId || null, JSON.stringify(merged.channels), merged.notes, merged.updatedAt]
        );
        return merged;
      }
      const client = normalizeClient(payload);
      await query(
        `INSERT INTO clients (id, name, handle, service, plan, status, owner_id, channels, notes, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11)`,
        [client.id, client.name, client.handle, client.service, client.plan, client.status, client.ownerId || null, JSON.stringify(client.channels), client.notes, client.createdAt, client.updatedAt]
      );
      return client;
    },
    async deleteClient(clientId) {
      const tasksRes = await query('SELECT COUNT(*)::int AS count FROM tasks WHERE client_id = $1', [clientId]);
      if (tasksRes.rows[0].count > 0) return { ok: false, code: 'CLIENT_HAS_TASKS' };
      const res = await query('DELETE FROM clients WHERE id=$1', [clientId]);
      return res.rowCount ? { ok: true } : { ok: false, code: 'NOT_FOUND' };
    },
    async saveTask(payload) {
      if (payload.id) {
        const currentRes = await query('SELECT * FROM tasks WHERE id=$1 LIMIT 1', [payload.id]);
        if (!currentRes.rows[0]) return null;
        const merged = normalizeTask({ ...mapTaskRow(currentRes.rows[0]), ...payload, id: payload.id, updatedAt: nowIso() });
        await query(
          `UPDATE tasks SET title=$2, description=$3, client_id=$4, type=$5, channel=$6, format=$7, assignee_id=$8, assignee_ids=$9::jsonb, priority=$10, status=$11, due_date=$12, publish_date=$13, approval_required=$14, resource_links=$15::jsonb, labels=$16::jsonb, checklist=$17::jsonb, subtasks=$18::jsonb, comments=$19::jsonb, created_by_id=$20, updated_at=$21 WHERE id=$1`,
          [merged.id, merged.title, merged.description, merged.clientId || null, merged.type, merged.channel, merged.format, merged.assigneeId || null, JSON.stringify(merged.assigneeIds || []), merged.priority, merged.status, merged.dueDate || null, merged.publishDate || null, merged.approvalRequired, JSON.stringify(merged.resourceLinks || []), JSON.stringify(merged.labels), JSON.stringify(merged.checklist), JSON.stringify(merged.subtasks || []), JSON.stringify(merged.comments), merged.createdById || null, merged.updatedAt]
        );
        const attachmentsRes = await query('SELECT * FROM attachments WHERE task_id=$1 ORDER BY created_at DESC', [merged.id]);
        return { ...merged, attachments: attachmentsRes.rows.map(mapAttachmentRow) };
      }
      const task = normalizeTask(payload);
      await query(
        `INSERT INTO tasks (id, title, description, client_id, type, channel, format, assignee_id, assignee_ids, priority, status, due_date, publish_date, approval_required, resource_links, labels, checklist, subtasks, comments, created_by_id, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,$17::jsonb,$18::jsonb,$19::jsonb,$20,$21,$22)`,
        [task.id, task.title, task.description, task.clientId || null, task.type, task.channel, task.format, task.assigneeId || null, JSON.stringify(task.assigneeIds || []), task.priority, task.status, task.dueDate || null, task.publishDate || null, task.approvalRequired, JSON.stringify(task.resourceLinks || []), JSON.stringify(task.labels), JSON.stringify(task.checklist), JSON.stringify(task.subtasks || []), JSON.stringify(task.comments), task.createdById || null, task.createdAt, task.updatedAt]
      );
      return { ...task, attachments: [] };
    },
    async deleteTask(taskId) {
      const attachmentsRes = await query('SELECT * FROM attachments WHERE task_id=$1', [taskId]);
      const res = await query('DELETE FROM tasks WHERE id=$1', [taskId]);
      attachmentsRes.rows.forEach((row) => {
        const filePath = path.join(UPLOADS_DIR, row.stored_name);
        if (row.stored_name && fs.existsSync(filePath)) fs.unlinkSync(filePath);
      });
      return res.rowCount ? { ok: true } : { ok: false, code: 'NOT_FOUND' };
    },
    async createAttachment(taskId, file, uploadedById) {
      const attachment = normalizeAttachment({
        taskId,
        originalName: file.originalname,
        storedName: file.filename,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        uploadedById
      });
      await query(
        `INSERT INTO attachments (id, task_id, original_name, stored_name, mime_type, size_bytes, uploaded_by_id, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [attachment.id, attachment.taskId, attachment.originalName, attachment.storedName, attachment.mimeType, attachment.sizeBytes, attachment.uploadedById || null, attachment.createdAt]
      );
      return attachment;
    },
    async getAttachment(attachmentId) {
      const res = await query('SELECT * FROM attachments WHERE id=$1 LIMIT 1', [attachmentId]);
      return res.rows[0] ? mapAttachmentRow(res.rows[0]) : null;
    },
    async deleteAttachment(attachmentId) {
      const attachment = await this.getAttachment(attachmentId);
      if (!attachment) return { ok: false, code: 'NOT_FOUND' };
      await query('DELETE FROM attachments WHERE id=$1', [attachmentId]);
      const filePath = path.join(UPLOADS_DIR, attachment.storedName);
      if (attachment.storedName && fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return { ok: true, attachment };
    },
    async getNotificationSettings() {
      const res = await query('SELECT settings, updated_at FROM notification_settings WHERE id = $1 LIMIT 1', ['default']);
      if (!res.rows[0]) {
        const settings = normalizeNotificationSettings();
        await query(`INSERT INTO notification_settings (id, settings, updated_at) VALUES ('default',$1::jsonb,$2)`, [JSON.stringify(settings), settings.updatedAt]);
        return settings;
      }
      return normalizeNotificationSettings({ ...(res.rows[0].settings || {}), updatedAt: res.rows[0].updated_at || nowIso() });
    },
    async saveNotificationSettings(payload) {
      const current = await this.getNotificationSettings();
      const merged = normalizeNotificationSettings({ ...current, ...payload, updatedAt: nowIso() });
      await query(
        `INSERT INTO notification_settings (id, settings, updated_at) VALUES ('default',$1::jsonb,$2)
         ON CONFLICT (id) DO UPDATE SET settings = EXCLUDED.settings, updated_at = EXCLUDED.updated_at`,
        [JSON.stringify(merged), merged.updatedAt]
      );
      return merged;
    },
    async findReminderEvent(dedupeKey) {
      const res = await query('SELECT * FROM reminder_events WHERE dedupe_key=$1 LIMIT 1', [dedupeKey]);
      return res.rows[0] ? normalizeReminderEvent({
        id: res.rows[0].id,
        kind: res.rows[0].kind,
        dedupeKey: res.rows[0].dedupe_key,
        taskId: res.rows[0].task_id,
        userId: res.rows[0].user_id,
        sentAt: res.rows[0].sent_at,
        meta: res.rows[0].meta,
        createdAt: res.rows[0].created_at
      }) : null;
    },
    async createReminderEvent(payload) {
      const event = normalizeReminderEvent(payload);
      await query(
        `INSERT INTO reminder_events (id, kind, dedupe_key, task_id, user_id, sent_at, meta, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
         ON CONFLICT (dedupe_key) DO NOTHING`,
        [event.id, event.kind, event.dedupeKey, event.taskId || null, event.userId || null, event.sentAt, JSON.stringify(event.meta || {}), event.createdAt]
      );
      return event;
    },
    async getWorkSessionForDate(userId, dateKey = todayDateKey()) {
      const res = await query('SELECT * FROM work_sessions WHERE user_id=$1 AND date_key=$2 LIMIT 1', [userId, dateKey]);
      return res.rows[0] ? mapWorkSessionRow(res.rows[0]) : null;
    },
    async saveWorkSession(payload) {
      const base = payload.id ? await query('SELECT * FROM work_sessions WHERE id=$1 LIMIT 1', [payload.id]).then((res) => res.rows[0] ? mapWorkSessionRow(res.rows[0]) : null) : await this.getWorkSessionForDate(payload.userId, normalizeDate(payload.dateKey));
      const session = normalizeWorkSession({ ...base, ...payload, id: base?.id || payload.id, updatedAt: nowIso() });
      await query(
        `INSERT INTO work_sessions (id, user_id, date_key, check_in_at, check_out_at, status, focus_plan, end_summary, blockers, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (user_id, date_key) DO UPDATE SET
           check_in_at = EXCLUDED.check_in_at,
           check_out_at = EXCLUDED.check_out_at,
           status = EXCLUDED.status,
           focus_plan = EXCLUDED.focus_plan,
           end_summary = EXCLUDED.end_summary,
           blockers = EXCLUDED.blockers,
           updated_at = EXCLUDED.updated_at`,
        [session.id, session.userId, session.dateKey, session.checkInAt || null, session.checkOutAt || null, session.status, session.focusPlan, session.endSummary, session.blockers, session.createdAt, session.updatedAt]
      );
      return session;
    },
    async listActivityLogs({ userId = '', limit = 50 } = {}) {
      const res = userId
        ? await query('SELECT * FROM activity_logs WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2', [userId, limit])
        : await query('SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT $1', [limit]);
      return res.rows.map(mapActivityLogRow);
    },
    async createActivityLog(payload) {
      const log = normalizeActivityLog(payload);
      await query(
        `INSERT INTO activity_logs (id, user_id, kind, label, entity_type, entity_id, meta, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
        [log.id, log.userId || null, log.kind, log.label, log.entityType || null, log.entityId || null, JSON.stringify(log.meta || {}), log.createdAt]
      );
      return log;
    },
    async createEmailToken({ userId, email, type, expiresHours = 24, meta = {} }) {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const token = normalizeEmailToken({
        userId,
        email,
        type,
        tokenHash: sha256(rawToken),
        expiresAt: new Date(Date.now() + expiresHours * 60 * 60 * 1000).toISOString(),
        meta
      });
      await query('DELETE FROM email_tokens WHERE user_id=$1 AND type=$2 AND used_at IS NULL', [userId, type]);
      await query(
        `INSERT INTO email_tokens (id, user_id, email, type, token_hash, expires_at, used_at, created_at, meta)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
        [token.id, token.userId || null, token.email, token.type, token.tokenHash, token.expiresAt, token.usedAt || null, token.createdAt, JSON.stringify(token.meta || {})]
      );
      return { rawToken, token };
    },
    async getValidToken(rawToken) {
      const res = await query(
        `SELECT et.*, u.* FROM email_tokens et LEFT JOIN users u ON u.id = et.user_id
         WHERE et.token_hash=$1 AND et.used_at IS NULL AND et.expires_at > NOW() LIMIT 1`,
        [sha256(rawToken)]
      );
      if (!res.rows[0]) return null;
      const row = res.rows[0];
      return {
        token: normalizeEmailToken({
          id: row.id,
          userId: row.user_id || '',
          email: row.email,
          type: row.type,
          tokenHash: row.token_hash,
          expiresAt: row.expires_at,
          usedAt: row.used_at || '',
          createdAt: row.created_at,
          meta: row.meta || {}
        }),
        user: row.user_id ? mapUserRow(row) : null
      };
    },
    async useToken(rawToken) {
      const tokenHash = sha256(rawToken);
      const res = await query('UPDATE email_tokens SET used_at = NOW() WHERE token_hash=$1 RETURNING *', [tokenHash]);
      return res.rows[0] || null;
    },
    async logEmail(payload) {
      const log = normalizeEmailLog(payload);
      await query(
        `INSERT INTO email_logs (id, to_email, subject, text_body, html_body, mode, preview_link, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [log.id, log.toEmail, log.subject, log.textBody, log.htmlBody, log.mode, log.previewLink || null, log.createdAt]
      );
      return log;
    }
  };
}

const adapter = process.env.DATABASE_URL ? createPostgresAdapter() : createFileAdapter();

function createMailer() {
  if (process.env.SMTP_HOST && process.env.SMTP_FROM) {
    return {
      mode: 'smtp',
      transporter: nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === 'true',
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' } : undefined
      })
    };
  }
  return {
    mode: 'log',
    transporter: nodemailer.createTransport({ jsonTransport: true })
  };
}

const mailer = createMailer();

async function sendTransactionalEmail({ to, subject, textBody, htmlBody, previewLink = '' }) {
  const payload = {
    from: process.env.SMTP_FROM || 'Zia WorkSpace <no-reply@zialab.com>',
    to,
    subject,
    text: textBody,
    html: htmlBody
  };
  await mailer.transporter.sendMail(payload);
  const log = await adapter.logEmail({
    toEmail: to,
    subject,
    textBody,
    htmlBody,
    mode: mailer.mode,
    previewLink
  });
  return { mode: mailer.mode, log };
}

async function createActionLink(user, type) {
  const { rawToken } = await adapter.createEmailToken({
    userId: user.id,
    email: user.email,
    type,
    expiresHours: type === TOKEN_TYPES.INVITE ? 72 : 2,
    meta: { userName: user.name }
  });
  return `${APP_BASE_URL}/?mode=${type}&token=${rawToken}`;
}

function buildInviteEmail(user, link) {
  const subject = 'Invitación a Zia WorkSpace';
  const textBody = `Hola ${user.name || 'equipo'},\n\nTe invitaron a Zia WorkSpace. Activa tu cuenta aquí:\n${link}\n\nEste enlace vence en 72 horas.`;
  const htmlBody = `<p>Hola <strong>${user.name || 'equipo'}</strong>,</p><p>Te invitaron a <strong>Zia WorkSpace</strong>. Activa tu cuenta aquí:</p><p><a href="${link}">${link}</a></p><p>Este enlace vence en 72 horas.</p>`;
  return { subject, textBody, htmlBody };
}

function buildResetEmail(user, link) {
  const subject = 'Recuperación de contraseña de Zia WorkSpace';
  const textBody = `Hola ${user.name || 'equipo'},\n\nRecibimos una solicitud para cambiar tu contraseña. Hazlo aquí:\n${link}\n\nEste enlace vence en 2 horas.`;
  const htmlBody = `<p>Hola <strong>${user.name || 'equipo'}</strong>,</p><p>Recibimos una solicitud para cambiar tu contraseña. Hazlo aquí:</p><p><a href="${link}">${link}</a></p><p>Este enlace vence en 2 horas.</p>`;
  return { subject, textBody, htmlBody };
}

async function sendInviteEmail(user) {
  const link = await createActionLink(user, TOKEN_TYPES.INVITE);
  const email = buildInviteEmail(user, link);
  const result = await sendTransactionalEmail({ to: user.email, ...email, previewLink: link });
  return { link, mode: result.mode };
}

async function sendResetEmail(user) {
  const link = await createActionLink(user, TOKEN_TYPES.RESET);
  const email = buildResetEmail(user, link);
  const result = await sendTransactionalEmail({ to: user.email, ...email, previewLink: link });
  return { link, mode: result.mode };
}

function getDatePartsInTimeZone(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    weekday: 'short'
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).filter((item) => item.type !== 'literal').map((item) => [item.type, item.value]));
  return parts;
}

function getTodayInTimeZone(timeZone) {
  const parts = getDatePartsInTimeZone(new Date(), timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function getHourInTimeZone(timeZone) {
  return Number(getDatePartsInTimeZone(new Date(), timeZone).hour || 0);
}

function getWeekdayInTimeZone(timeZone) {
  return String(getDatePartsInTimeZone(new Date(), timeZone).weekday || '').toLowerCase();
}

function daysBetweenDates(fromDateString, toDateString) {
  if (!fromDateString || !toDateString) return 0;
  const [fy, fm, fd] = String(fromDateString).split('-').map(Number);
  const [ty, tm, td] = String(toDateString).split('-').map(Number);
  const from = Date.UTC(fy, (fm || 1) - 1, fd || 1);
  const to = Date.UTC(ty, (tm || 1) - 1, td || 1);
  return Math.round((to - from) / (1000 * 60 * 60 * 24));
}

function isTaskOpen(task) {
  return Boolean(task) && task.status !== 'scheduled';
}

function buildWorkspaceLink() {
  return APP_BASE_URL;
}

function getClientName(clients, clientId) {
  return clients.find((client) => client.id === clientId)?.name || 'Sin cliente';
}

function buildTaskAssignmentEmail(user, task, clientName) {
  const subject = `Nueva tarea asignada: ${task.title}`;
  const link = buildWorkspaceLink();
  const textBody = `Hola ${user.name || 'equipo'},

Se te asignó una tarea en Zia WorkSpace.

Tarea: ${task.title}
Cliente: ${clientName}
Estado: ${statusText(task.status)}
Fecha límite: ${task.dueDate || 'Sin fecha'}

Abre tu panel aquí: ${link}`;
  const htmlBody = `<p>Hola <strong>${user.name || 'equipo'}</strong>,</p><p>Se te asignó una tarea en <strong>Zia WorkSpace</strong>.</p><ul><li><strong>Tarea:</strong> ${task.title}</li><li><strong>Cliente:</strong> ${clientName}</li><li><strong>Estado:</strong> ${statusText(task.status)}</li><li><strong>Fecha límite:</strong> ${task.dueDate || 'Sin fecha'}</li></ul><p><a href="${link}">Abrir Zia WorkSpace</a></p>`;
  return { subject, textBody, htmlBody, previewLink: link };
}

function buildTaskReminderEmail(user, task, clientName, kind, meta = {}) {
  const link = buildWorkspaceLink();
  const labels = {
    dueSoon: `vence ${meta.daysLeft === 0 ? 'hoy' : `en ${meta.daysLeft} día${meta.daysLeft === 1 ? '' : 's'}`}`,
    overdue: `está vencida desde hace ${meta.daysOverdue} día${meta.daysOverdue === 1 ? '' : 's'}`
  };
  const subject = kind === 'dueSoon'
    ? `Recordatorio: ${task.title} vence pronto`
    : `Tarea vencida: ${task.title}`;
  const textBody = `Hola ${user.name || 'equipo'},

Tu tarea "${task.title}" ${labels[kind] || 'requiere atención'}.
Cliente: ${clientName}
Estado actual: ${statusText(task.status)}
Fecha límite: ${task.dueDate || 'Sin fecha'}

Entra a Zia WorkSpace: ${link}`;
  const htmlBody = `<p>Hola <strong>${user.name || 'equipo'}</strong>,</p><p>Tu tarea <strong>${task.title}</strong> ${labels[kind] || 'requiere atención'}.</p><ul><li><strong>Cliente:</strong> ${clientName}</li><li><strong>Estado actual:</strong> ${statusText(task.status)}</li><li><strong>Fecha límite:</strong> ${task.dueDate || 'Sin fecha'}</li></ul><p><a href="${link}">Abrir Zia WorkSpace</a></p>`;
  return { subject, textBody, htmlBody, previewLink: link };
}

function buildDailyDigestEmail(user, tasks, clients, timeZone) {
  const today = getTodayInTimeZone(timeZone);
  const link = buildWorkspaceLink();
  const lines = tasks.map((task) => {
    const clientName = getClientName(clients, task.clientId);
    return `- ${task.title} · ${clientName} · ${statusText(task.status)} · vence ${task.dueDate || 'sin fecha'}`;
  });
  const listHtml = tasks.map((task) => `<li><strong>${task.title}</strong> · ${getClientName(clients, task.clientId)} · ${statusText(task.status)} · vence ${task.dueDate || 'sin fecha'}</li>`).join('');
  const subject = `Resumen diario de tareas pendientes · ${today}`;
  const textBody = `Hola ${user.name || 'equipo'},

Estas son tus tareas abiertas de hoy en Zia WorkSpace:

${lines.join('\n')}

Abre tu panel: ${link}`;
  const htmlBody = `<p>Hola <strong>${user.name || 'equipo'}</strong>,</p><p>Estas son tus tareas abiertas de hoy en <strong>Zia WorkSpace</strong>:</p><ul>${listHtml}</ul><p><a href="${link}">Abrir Zia WorkSpace</a></p>`;
  return { subject, textBody, htmlBody, previewLink: link };
}

let reminderRunnerState = { running: false, lastRunAt: '', lastError: '' };

async function safeLogActivity(payload = {}) {
  try {
    if (!payload.userId || typeof adapter?.createActivityLog !== 'function') return null;
    return await adapter.createActivityLog({
      userId: payload.userId,
      kind: payload.kind || 'generic',
      label: payload.label || 'Actividad registrada',
      entityType: payload.entityType || '',
      entityId: payload.entityId || '',
      meta: payload.meta || {},
      createdAt: payload.createdAt || nowIso()
    });
  } catch (error) {
    console.error('No se pudo registrar actividad:', error.message);
    return null;
  }
}

async function maybeSendTaskAssignmentEmail(task, previousTask = null) {
  const settings = await adapter.getNotificationSettings();
  const currentIds = getTaskAssigneeIds(task);
  if (!settings.enabled || !settings.assignmentEmails || !currentIds.length || task.status === 'scheduled') return null;
  const previousIds = previousTask ? getTaskAssigneeIds(previousTask) : [];
  const targetIds = previousTask ? currentIds.filter((id) => !previousIds.includes(id)) : currentIds;
  if (!targetIds.length) return null;
  const bootstrapUser = await adapter.listUsers().then((users) => users.find((item) => item.role === 'Admin') || users[0] || { role: 'Admin' });
  const bootstrap = await adapter.getBootstrap(bootstrapUser);
  let sent = 0;
  for (const userId of targetIds) {
    const user = await adapter.getUserById(userId);
    if (!user || user.status !== 'active' || !user.email) continue;
    const email = buildTaskAssignmentEmail(user, task, getClientName(bootstrap.clients, task.clientId));
    await sendTransactionalEmail({ to: user.email, ...email });
    sent += 1;
  }
  return { ok: true, sent };
}

async function processTaskReminders({ triggeredBy = 'system' } = {}) {
  if (reminderRunnerState.running) {
    return { ok: false, skipped: true, reason: 'already_running' };
  }
  reminderRunnerState.running = true;
  reminderRunnerState.lastRunAt = nowIso();
  reminderRunnerState.lastError = '';
  try {
    const users = await adapter.listUsers();
    const settings = await adapter.getNotificationSettings();
    const actingUser = users.find((item) => item.role === 'Admin') || users[0];
    if (!actingUser) {
      return { ok: true, sent: 0, skipped: 0, reason: 'no_users' };
    }
    if (!settings.enabled) {
      return { ok: true, sent: 0, skipped: 0, reason: 'reminders_disabled' };
    }
    const snapshot = await adapter.getBootstrap(actingUser);
    const activeUsers = snapshot.users.filter((user) => user.status === 'active' && user.email);
    const tasks = snapshot.tasks.filter(isTaskOpen);
    const today = getTodayInTimeZone(settings.timezone);
    const currentHour = getHourInTimeZone(settings.timezone);
    const weekday = getWeekdayInTimeZone(settings.timezone);
    const allowDigestToday = settings.weekendDigest || !['sat', 'sun'].includes(weekday);
    let sent = 0;
    let skipped = 0;

    for (const user of activeUsers) {
      const assignedTasks = tasks.filter((task) => getTaskAssigneeIds(task).includes(user.id));
      if (!assignedTasks.length) continue;

      const shouldRunDigest = settings.dailyDigestEnabled && allowDigestToday && (triggeredBy !== 'scheduler' || currentHour === Number(settings.dailyDigestHour || 8));
      if (shouldRunDigest) {
        const digestKey = `digest:${today}:${user.id}`;
        if (!(await adapter.findReminderEvent(digestKey))) {
          const email = buildDailyDigestEmail(user, assignedTasks, snapshot.clients, settings.timezone);
          await sendTransactionalEmail({ to: user.email, ...email });
          await adapter.createReminderEvent({ kind: 'digest', dedupeKey: digestKey, userId: user.id, meta: { taskCount: assignedTasks.length, triggeredBy } });
          sent += 1;
        } else {
          skipped += 1;
        }
      }

      for (const task of assignedTasks) {
        if (!task.dueDate) continue;
        const daysLeft = daysBetweenDates(today, task.dueDate);
        if (settings.dueSoonEnabled) {
          const dueWindowDays = Math.max(1, Math.ceil(Number(settings.dueSoonHours || 24) / 24));
          if (daysLeft >= 0 && daysLeft <= dueWindowDays) {
            const dedupeKey = `due_soon:${task.id}:${user.id}:${task.dueDate}`;
            if (!(await adapter.findReminderEvent(dedupeKey))) {
              const email = buildTaskReminderEmail(user, task, getClientName(snapshot.clients, task.clientId), 'dueSoon', { daysLeft });
              await sendTransactionalEmail({ to: user.email, ...email });
              await adapter.createReminderEvent({ kind: 'due_soon', dedupeKey, taskId: task.id, userId: user.id, meta: { daysLeft, triggeredBy } });
              sent += 1;
            } else {
              skipped += 1;
            }
          }
        }
        if (settings.overdueEnabled && daysLeft < 0) {
          const daysOverdue = Math.abs(daysLeft);
          const repeatDays = Math.max(1, Math.ceil(Number(settings.overdueRepeatHours || 24) / 24));
          const bucket = Math.floor((daysOverdue - 1) / repeatDays);
          const dedupeKey = `overdue:${task.id}:${user.id}:${bucket}`;
          if (!(await adapter.findReminderEvent(dedupeKey))) {
            const email = buildTaskReminderEmail(user, task, getClientName(snapshot.clients, task.clientId), 'overdue', { daysOverdue });
            await sendTransactionalEmail({ to: user.email, ...email });
            await adapter.createReminderEvent({ kind: 'overdue', dedupeKey, taskId: task.id, userId: user.id, meta: { daysOverdue, bucket, triggeredBy } });
            sent += 1;
          } else {
            skipped += 1;
          }
        }
      }
    }

    return { ok: true, sent, skipped, timezone: settings.timezone, hour: currentHour, triggeredBy };
  } catch (error) {
    reminderRunnerState.lastError = error.message;
    throw error;
  } finally {
    reminderRunnerState.running = false;
  }
}

function startReminderScheduler() {
  if (process.env.REMINDER_AUTO_RUN === 'false') return;
  const intervalMs = Math.max(1, Number(process.env.REMINDER_INTERVAL_MINUTES || 15)) * 60 * 1000;
  setInterval(() => {
    processTaskReminders({ triggeredBy: 'scheduler' }).catch((error) => {
      console.error('Reminder scheduler error:', error);
    });
  }, intervalMs);
}

async function attachCurrentUser(req, _res, next) {
  try {
    const cookies = parseCookies(req);
    const rawToken = cookies[SESSION_COOKIE];
    req.currentUser = rawToken ? await adapter.getUserBySessionToken(rawToken) : null;
    req.rawSessionToken = rawToken || '';
    next();
  } catch (error) {
    next(error);
  }
}

function requireAuth(req, res, next) {
  if (!req.currentUser) {
    res.status(401).json({ error: 'Necesitas iniciar sesión.' });
    return;
  }
  if (req.currentUser.status !== 'active') {
    res.status(403).json({ error: 'Tu usuario no está activo.' });
    return;
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.currentUser || req.currentUser.role !== 'Admin') {
    res.status(403).json({ error: 'Acceso solo para admin.' });
    return;
  }
  next();
}

app.use(attachCurrentUser);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'zia-flow', storage: adapter.kind, timestamp: nowIso() });
});

app.get('/api/auth/session', (req, res) => {
  if (!req.currentUser) {
    res.status(401).json({ error: 'No hay sesión activa.' });
    return;
  }
  res.json({ user: sanitizeUser(req.currentUser) });
});

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const user = await adapter.findUserByEmail(email);
    if (!user || !user.passwordHash || !verifyPassword(password, user.passwordHash)) {
      res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
      return;
    }
    if (user.status !== 'active') {
      res.status(403).json({ error: 'Tu usuario no está activo. Revisa tu invitación o contacta al admin.' });
      return;
    }
    const token = await adapter.createSession(user.id);
    if (adapter.kind === 'postgres') {
      await adapter.updateUser(user.id, { ...user, lastLoginAt: nowIso() });
    } else {
      await adapter.updateUser(user.id, { lastLoginAt: nowIso() });
    }
    setSessionCookie(res, token);
    if (typeof adapter.createActivityLog === 'function') await adapter.createActivityLog({ userId: user.id, kind: 'login', label: 'Inició sesión en Zia WorkSpace.', entityType: 'session', entityId: user.id });
    res.json({ ok: true, user: sanitizeUser(await adapter.getUserById(user.id)) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/logout', requireAuth, async (req, res, next) => {
  try {
    if (req.rawSessionToken) await adapter.deleteSession(req.rawSessionToken);
    if (typeof adapter.createActivityLog === 'function') await adapter.createActivityLog({ userId: req.currentUser.id, kind: 'logout', label: 'Cerró sesión.', entityType: 'session', entityId: req.currentUser.id });
    clearSessionCookie(res);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/forgot-password', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const user = email ? await adapter.findUserByEmail(email) : null;
    let previewLink = '';
    if (user && user.status !== 'suspended') {
      const delivery = await sendResetEmail(user);
      if (delivery.mode === 'log') previewLink = delivery.link;
    }
    res.json({ ok: true, message: 'Si el correo existe, enviamos un enlace para recuperar la contraseña.', previewLink });
  } catch (error) {
    next(error);
  }
});

app.get('/api/auth/token-status', async (req, res, next) => {
  try {
    const tokenValue = String(req.query.token || '');
    if (!tokenValue) {
      res.status(400).json({ error: 'Token requerido.' });
      return;
    }
    const result = await adapter.getValidToken(tokenValue);
    if (!result) {
      res.status(404).json({ error: 'El enlace no es válido o ya venció.' });
      return;
    }
    res.json({
      ok: true,
      type: result.token.type,
      email: result.token.email,
      name: result.user?.name || '',
      expiresAt: result.token.expiresAt
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/complete-token', async (req, res, next) => {
  try {
    const tokenValue = String(req.body.token || '');
    const password = String(req.body.password || '');
    const name = String(req.body.name || '').trim();
    if (!tokenValue || password.length < 8) {
      res.status(400).json({ error: 'Debes enviar un token válido y una contraseña de al menos 8 caracteres.' });
      return;
    }
    const result = await adapter.getValidToken(tokenValue);
    if (!result || !result.user) {
      res.status(404).json({ error: 'El enlace no es válido o ya venció.' });
      return;
    }
    const updates = result.token.type === TOKEN_TYPES.INVITE ? { name: name || result.user.name, status: 'active' } : {};
    await adapter.updateUser(result.user.id, updates);
    await adapter.setUserPassword(result.user.id, password);
    await adapter.useToken(tokenValue);
    const freshUser = await adapter.getUserById(result.user.id);
    const sessionToken = await adapter.createSession(freshUser.id);
    setSessionCookie(res, sessionToken);
    if (typeof adapter.createActivityLog === 'function') await adapter.createActivityLog({ userId: freshUser.id, kind: 'login', label: 'Activó su cuenta e inició sesión.', entityType: 'session', entityId: freshUser.id });
    res.json({ ok: true, user: sanitizeUser(freshUser) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/bootstrap', requireAuth, async (req, res, next) => {
  try {
    const bootstrap = await adapter.getBootstrap(req.currentUser);
    res.json(bootstrap);
  } catch (error) {
    next(error);
  }
});

app.patch('/api/profile', requireAuth, async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!name || !email) {
      res.status(400).json({ error: 'Nombre y correo son obligatorios.' });
      return;
    }
    const existing = await adapter.findUserByEmail(email);
    if (existing && existing.id !== req.currentUser.id) {
      res.status(409).json({ error: 'Ese correo ya está en uso.' });
      return;
    }
    const updated = await adapter.updateUser(req.currentUser.id, { ...req.currentUser, name, email, updatedAt: nowIso() });
    if (typeof adapter.createActivityLog === 'function') await adapter.createActivityLog({ userId: req.currentUser.id, kind: 'profile_update', label: 'Actualizó su perfil.', entityType: 'user', entityId: req.currentUser.id });
    res.json({ ok: true, user: updated });
  } catch (error) {
    next(error);
  }
});

app.post('/api/profile/password', requireAuth, async (req, res, next) => {
  try {
    const currentPassword = String(req.body.currentPassword || '');
    const newPassword = String(req.body.newPassword || '');
    const currentUser = await adapter.getUserById(req.currentUser.id);
    if (!verifyPassword(currentPassword, currentUser.passwordHash)) {
      res.status(400).json({ error: 'La contraseña actual no coincide.' });
      return;
    }
    if (newPassword.length < 8) {
      res.status(400).json({ error: 'La nueva contraseña debe tener al menos 8 caracteres.' });
      return;
    }
    await adapter.setUserPassword(req.currentUser.id, newPassword);
    if (typeof adapter.createActivityLog === 'function') await adapter.createActivityLog({ userId: req.currentUser.id, kind: 'password_update', label: 'Cambió su contraseña.', entityType: 'user', entityId: req.currentUser.id });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});


app.get('/api/work/session/today', requireAuth, async (req, res, next) => {
  try {
    const session = await adapter.getWorkSessionForDate(req.currentUser.id, todayDateKey());
    res.json(session || null);
  } catch (error) {
    next(error);
  }
});

app.put('/api/work/session/today', requireAuth, async (req, res, next) => {
  try {
    const existing = await adapter.getWorkSessionForDate(req.currentUser.id, todayDateKey());
    const session = await adapter.saveWorkSession({
      ...(existing || {}),
      userId: req.currentUser.id,
      dateKey: todayDateKey(),
      status: req.body.status || existing?.status || 'available',
      focusPlan: req.body.focusPlan ?? existing?.focusPlan ?? '',
      endSummary: req.body.endSummary ?? existing?.endSummary ?? '',
      blockers: req.body.blockers ?? existing?.blockers ?? '',
      checkInAt: existing?.checkInAt || '',
      checkOutAt: existing?.checkOutAt || '',
      updatedAt: nowIso()
    });
    if (typeof adapter.createActivityLog === 'function') await adapter.createActivityLog({ userId: req.currentUser.id, kind: 'session_update', label: 'Actualizó su jornada remota.', entityType: 'work_session', entityId: session.id, meta: { status: session.status } });
    res.json({ ok: true, session });
  } catch (error) {
    next(error);
  }
});

app.post('/api/work/check-in', requireAuth, async (req, res, next) => {
  try {
    const existing = await adapter.getWorkSessionForDate(req.currentUser.id, todayDateKey());
    const session = await adapter.saveWorkSession({
      ...(existing || {}),
      userId: req.currentUser.id,
      dateKey: todayDateKey(),
      checkInAt: existing?.checkInAt || nowIso(),
      checkOutAt: existing?.checkOutAt || '',
      status: req.body.status || existing?.status || 'available',
      focusPlan: req.body.focusPlan ?? existing?.focusPlan ?? '',
      endSummary: req.body.endSummary ?? existing?.endSummary ?? '',
      blockers: req.body.blockers ?? existing?.blockers ?? '',
      updatedAt: nowIso()
    });
    if (typeof adapter.createActivityLog === 'function') await adapter.createActivityLog({ userId: req.currentUser.id, kind: 'check_in', label: 'Marcó entrada remota.', entityType: 'work_session', entityId: session.id, meta: { status: session.status } });
    res.json({ ok: true, session });
  } catch (error) {
    next(error);
  }
});

app.post('/api/work/check-out', requireAuth, async (req, res, next) => {
  try {
    const existing = await adapter.getWorkSessionForDate(req.currentUser.id, todayDateKey());
    const session = await adapter.saveWorkSession({
      ...(existing || {}),
      userId: req.currentUser.id,
      dateKey: todayDateKey(),
      checkInAt: existing?.checkInAt || nowIso(),
      checkOutAt: nowIso(),
      status: req.body.status || 'offline',
      focusPlan: req.body.focusPlan ?? existing?.focusPlan ?? '',
      endSummary: req.body.endSummary ?? existing?.endSummary ?? '',
      blockers: req.body.blockers ?? existing?.blockers ?? '',
      updatedAt: nowIso()
    });
    if (typeof adapter.createActivityLog === 'function') await adapter.createActivityLog({ userId: req.currentUser.id, kind: 'check_out', label: 'Marcó salida remota.', entityType: 'work_session', entityId: session.id, meta: { status: session.status } });
    res.json({ ok: true, session });
  } catch (error) {
    next(error);
  }
});

app.get('/api/tasks', requireAuth, async (req, res, next) => {
  try {
    const bootstrap = await adapter.getBootstrap(req.currentUser);
    res.json(bootstrap.tasks);
  } catch (error) {
    next(error);
  }
});

app.post('/api/tasks', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const payload = { ...req.body, createdById: req.currentUser.id, updatedAt: nowIso() };
    delete payload.id;
    const task = await adapter.saveTask(payload);
    await maybeSendTaskAssignmentEmail(task, null);
    if (typeof adapter.createActivityLog === 'function') await adapter.createActivityLog({ userId: req.currentUser.id, kind: 'task_create', label: `Creó la tarea "${task.title}".`, entityType: 'task', entityId: task.id, meta: { status: task.status } });
    res.status(201).json(task);
  } catch (error) {
    next(error);
  }
});

app.patch('/api/tasks/:id', requireAuth, async (req, res, next) => {
  try {
    const previousTask = await adapter.getBootstrap(req.currentUser).then((data) => data.tasks.find((item) => item.id === req.params.id) || null);
    const task = await adapter.saveTask({ ...req.body, id: req.params.id, updatedAt: nowIso() });
    if (!task) {
      res.status(404).json({ error: 'Tarea no encontrada.' });
      return;
    }
    await maybeSendTaskAssignmentEmail(task, previousTask);
    if (typeof adapter.createActivityLog === 'function') await adapter.createActivityLog({ userId: req.currentUser.id, kind: 'task_update', label: `Actualizó la tarea "${task.title}".`, entityType: 'task', entityId: task.id, meta: { status: task.status } });
    res.json(task);
  } catch (error) {
    next(error);
  }
});

app.delete('/api/tasks/:id', requireAuth, async (req, res, next) => {
  try {
    const previousTask = await adapter.getBootstrap(req.currentUser).then((data) => data.tasks.find((item) => item.id === req.params.id) || null);
    const result = await adapter.deleteTask(req.params.id);
    if (!result.ok) {
      res.status(404).json({ error: 'Tarea no encontrada.' });
      return;
    }
    if (typeof adapter.createActivityLog === 'function') await adapter.createActivityLog({ userId: req.currentUser.id, kind: 'task_delete', label: `Eliminó la tarea "${previousTask?.title || req.params.id}".`, entityType: 'task', entityId: req.params.id });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post('/api/tasks/:id/attachments', requireAuth, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'Debes subir un archivo.' });
      return;
    }
    const tasks = await adapter.getBootstrap(req.currentUser).then((data) => data.tasks);
    const task = tasks.find((item) => item.id === req.params.id);
    if (!task) {
      fs.unlinkSync(req.file.path);
      res.status(404).json({ error: 'Tarea no encontrada.' });
      return;
    }
    const attachment = await adapter.createAttachment(req.params.id, req.file, req.currentUser.id);
    if (typeof adapter.createActivityLog === 'function') await adapter.createActivityLog({ userId: req.currentUser.id, kind: 'attachment_upload', label: `Subió un adjunto a "${task.title}".`, entityType: 'attachment', entityId: attachment.id, meta: { taskId: task.id } });
    res.status(201).json(attachment);
  } catch (error) {
    next(error);
  }
});

app.get('/api/attachments/:id/download', requireAuth, async (req, res, next) => {
  try {
    const attachment = await adapter.getAttachment(req.params.id);
    if (!attachment) {
      res.status(404).json({ error: 'Adjunto no encontrado.' });
      return;
    }
    const filePath = path.join(UPLOADS_DIR, attachment.storedName);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'El archivo no existe en disco.' });
      return;
    }
    res.download(filePath, attachment.originalName);
  } catch (error) {
    next(error);
  }
});

app.delete('/api/attachments/:id', requireAuth, async (req, res, next) => {
  try {
    const result = await adapter.deleteAttachment(req.params.id);
    if (!result.ok) {
      res.status(404).json({ error: 'Adjunto no encontrado.' });
      return;
    }
    if (typeof adapter.createActivityLog === 'function') await adapter.createActivityLog({ userId: req.currentUser.id, kind: 'attachment_delete', label: 'Eliminó un adjunto.', entityType: 'attachment', entityId: req.params.id });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get('/api/clients', requireAuth, async (req, res, next) => {
  try {
    const bootstrap = await adapter.getBootstrap(req.currentUser);
    res.json(bootstrap.clients);
  } catch (error) {
    next(error);
  }
});

app.post('/api/clients', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const client = await adapter.saveClient({ ...req.body, updatedAt: nowIso() });
    res.status(201).json(client);
  } catch (error) {
    next(error);
  }
});

app.patch('/api/clients/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const client = await adapter.saveClient({ ...req.body, id: req.params.id, updatedAt: nowIso() });
    if (!client) {
      res.status(404).json({ error: 'Cliente no encontrado.' });
      return;
    }
    res.json(client);
  } catch (error) {
    next(error);
  }
});

app.delete('/api/clients/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const result = await adapter.deleteClient(req.params.id);
    if (!result.ok) {
      if (result.code === 'CLIENT_HAS_TASKS') {
        res.status(409).json({ error: 'Ese cliente tiene tareas asociadas. Reasígnalas o elimínalas primero.' });
        return;
      }
      res.status(404).json({ error: 'Cliente no encontrado.' });
      return;
    }
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get('/api/users', requireAuth, async (_req, res, next) => {
  try {
    const users = await adapter.listUsers();
    res.json(users);
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/users', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const name = String(req.body.name || '').trim();
    const password = String(req.body.password || '');
    const sendInvite = Boolean(req.body.sendInvite);
    if (!name || !email) {
      res.status(400).json({ error: 'Nombre y correo son obligatorios.' });
      return;
    }
    if (await adapter.findUserByEmail(email)) {
      res.status(409).json({ error: 'Ese correo ya existe.' });
      return;
    }
    const userPayload = normalizeUser({
      name,
      email,
      role: req.body.role || 'Colaborador',
      accent: req.body.accent || 'default',
      status: sendInvite && !password ? 'invited' : (req.body.status || 'active'),
      passwordHash: password ? hashPassword(password) : ''
    });
    const user = await adapter.createUser(userPayload);
    let previewLink = '';
    let deliveryMode = '';
    if (sendInvite || !password) {
      const delivery = await sendInviteEmail({ ...userPayload });
      previewLink = delivery.mode === 'log' ? delivery.link : '';
      deliveryMode = delivery.mode;
    }
    res.status(201).json({ ok: true, user, previewLink, deliveryMode });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/admin/users/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const target = await adapter.getUserById(req.params.id);
    if (!target) {
      res.status(404).json({ error: 'Usuario no encontrado.' });
      return;
    }
    const email = String(req.body.email || target.email).trim().toLowerCase();
    const existing = await adapter.findUserByEmail(email);
    if (existing && existing.id !== target.id) {
      res.status(409).json({ error: 'Ese correo ya está en uso.' });
      return;
    }
    const updated = await adapter.updateUser(target.id, {
      ...target,
      name: String(req.body.name || target.name).trim(),
      email,
      role: req.body.role || target.role,
      accent: req.body.accent || target.accent,
      status: req.body.status || target.status,
      updatedAt: nowIso()
    });
    res.json({ ok: true, user: updated });
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/users/:id/password', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const password = String(req.body.password || '');
    if (password.length < 8) {
      res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' });
      return;
    }
    const target = await adapter.getUserById(req.params.id);
    if (!target) {
      res.status(404).json({ error: 'Usuario no encontrado.' });
      return;
    }
    await adapter.setUserPassword(target.id, password);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/users/:id/invite', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const user = await adapter.getUserById(req.params.id);
    if (!user) {
      res.status(404).json({ error: 'Usuario no encontrado.' });
      return;
    }
    const delivery = await sendInviteEmail(user);
    await adapter.updateUser(user.id, { ...user, status: 'invited', updatedAt: nowIso() });
    res.json({ ok: true, previewLink: delivery.mode === 'log' ? delivery.link : '', deliveryMode: delivery.mode });
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/users/:id/password-reset', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const user = await adapter.getUserById(req.params.id);
    if (!user) {
      res.status(404).json({ error: 'Usuario no encontrado.' });
      return;
    }
    const delivery = await sendResetEmail(user);
    res.json({ ok: true, previewLink: delivery.mode === 'log' ? delivery.link : '', deliveryMode: delivery.mode });
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/email-logs', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const bootstrap = await adapter.getBootstrap(req.currentUser);
    res.json(bootstrap.emailLogs);
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/notification-settings', requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    res.json(await adapter.getNotificationSettings());
  } catch (error) {
    next(error);
  }
});

app.put('/api/admin/notification-settings', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const saved = await adapter.saveNotificationSettings(req.body || {});
    res.json(saved);
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/reminders/run', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const result = await processTaskReminders({ triggeredBy: req.currentUser.email || 'admin' });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.use((error, _req, res, _next) => {
  console.error('Zia WorkSpace error:', error);
  const isUploadError = error?.code === 'LIMIT_FILE_SIZE';
  res.status(isUploadError ? 413 : 500).json({
    error: isUploadError ? 'El archivo excede el tamaño permitido.' : 'Error interno del servidor.',
    detail: error.message
  });
});

(async () => {
  await adapter.init();
  startReminderScheduler();
  app.listen(PORT, () => {
    console.log(`Zia WorkSpace running on ${APP_BASE_URL} · storage=${adapter.kind}`);
  });
})();
