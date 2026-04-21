const STATUS_CONFIG = [
  { key: 'brief', label: 'Brief' },
  { key: 'copy', label: 'Copy' },
  { key: 'design', label: 'Diseño' },
  { key: 'doing', label: 'En proceso' },
  { key: 'review', label: 'Revisión' },
  { key: 'client', label: 'Cliente' },
  { key: 'approved', label: 'Aprobado' },
  { key: 'scheduled', label: 'Programado' },
  { key: 'published', label: 'Publicado' }
];

const state = {
  brand: { name: 'Zia WorkSpace', subtitle: 'Zia Lab Agency' },
  currentUser: null,
  users: [],
  clients: [],
  tasks: [],
  emailLogs: [],
  notificationSettings: {
    enabled: true,
    timezone: 'America/Santo_Domingo',
    assignmentEmails: true,
    dailyDigestEnabled: true,
    dailyDigestHour: 8,
    dueSoonEnabled: true,
    dueSoonHours: 24,
    overdueEnabled: true,
    overdueRepeatHours: 24,
    weekendDigest: true
  },
  tab: 'dashboard',
  taskView: 'board',
  filters: {
    search: '',
    clientId: 'all',
    assigneeId: 'all',
    priority: 'all'
  },
  calendarCursor: startOfMonth(new Date()),
  dragTaskId: '',
  authMode: 'login',
  tokenMode: '',
  tokenValue: ''
};

const els = {
  authShell: document.getElementById('authShell'),
  appShell: document.getElementById('appShell'),
  navTabs: document.getElementById('navTabs'),
  adminNavButton: document.getElementById('adminNavButton'),
  sidebarQuickStats: document.getElementById('sidebarQuickStats'),
  pageTitle: document.getElementById('pageTitle'),
  topbarEyebrow: document.getElementById('topbarEyebrow'),
  sidebar: document.getElementById('sidebar'),
  sidebarScrim: document.getElementById('sidebarScrim'),
  mobileMenuButton: document.getElementById('mobileMenuButton'),
  sidebarCloseButton: document.getElementById('sidebarCloseButton'),
  toolbarSection: document.getElementById('toolbarSection'),
  workspace: document.getElementById('workspace'),
  newTaskButton: document.getElementById('newTaskButton'),
  newClientButton: document.getElementById('newClientButton'),
  newUserButton: document.getElementById('newUserButton'),
  logoutButton: document.getElementById('logoutButton'),
  globalSearch: document.getElementById('globalSearch'),
  clientFilter: document.getElementById('clientFilter'),
  assigneeFilter: document.getElementById('assigneeFilter'),
  priorityFilter: document.getElementById('priorityFilter'),
  taskViewToggle: document.getElementById('taskViewToggle'),
  toastContainer: document.getElementById('toastContainer'),
  loginView: document.getElementById('loginView'),
  forgotView: document.getElementById('forgotView'),
  tokenView: document.getElementById('tokenView'),
  authPanels: document.getElementById('authPanels'),
  authTabLogin: document.getElementById('authTabLogin'),
  authTabForgot: document.getElementById('authTabForgot'),
  tokenIntro: document.getElementById('tokenIntro'),
  tokenNameFieldWrap: document.getElementById('tokenNameFieldWrap'),
  tokenButton: document.getElementById('tokenButton'),
  taskModalBackdrop: document.getElementById('taskModalBackdrop'),
  clientModalBackdrop: document.getElementById('clientModalBackdrop'),
  userModalBackdrop: document.getElementById('userModalBackdrop'),
  taskForm: document.getElementById('taskForm'),
  clientForm: document.getElementById('clientForm'),
  userForm: document.getElementById('userForm'),
  taskModalTitle: document.getElementById('taskModalTitle'),
  clientModalTitle: document.getElementById('clientModalTitle'),
  userModalTitle: document.getElementById('userModalTitle'),
  deleteTaskButton: document.getElementById('deleteTaskButton'),
  deleteClientButton: document.getElementById('deleteClientButton')
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options
  });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    const message = typeof data === 'string' ? data : data.error || data.detail || 'Error inesperado';
    throw new Error(message);
  }
  return data;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function showToast(title, message, type = 'default') {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<strong>${escapeHtml(title)}</strong><div class="small-text">${escapeHtml(message)}</div>`;
  if (type === 'error') {
    toast.style.borderColor = 'rgba(239, 91, 91, 0.28)';
  }
  els.toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), 4200);
}

function isoDate(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('es-DO', { day: '2-digit', month: 'short' }).format(date);
}

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('es-DO', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function statusLabel(key) {
  return STATUS_CONFIG.find((item) => item.key === key)?.label || key;
}

function priorityClass(priority) {
  const lower = String(priority || '').toLowerCase();
  if (lower.startsWith('alta')) return 'high';
  if (lower.startsWith('baja')) return 'low';
  return 'medium';
}

function getUserName(userId) {
  return state.users.find((user) => user.id === userId)?.name || 'Sin asignar';
}

function getClientName(clientId) {
  return state.clients.find((client) => client.id === clientId)?.name || 'Sin cliente';
}

function parseLinesToChecklist(text, originalChecklist = []) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const existing = originalChecklist.find((item) => item.text.toLowerCase() === line.toLowerCase());
      return existing ? existing : { text: line, done: false };
    });
}

function getFilteredTasks() {
  return state.tasks.filter((task) => {
    if (state.filters.clientId !== 'all' && task.clientId !== state.filters.clientId) return false;
    if (state.filters.assigneeId !== 'all' && task.assigneeId !== state.filters.assigneeId) return false;
    if (state.filters.priority !== 'all' && task.priority !== state.filters.priority) return false;
    const haystack = `${task.title} ${task.description} ${getClientName(task.clientId)} ${getUserName(task.assigneeId)}`.toLowerCase();
    if (state.filters.search && !haystack.includes(state.filters.search.toLowerCase())) return false;
    return true;
  });
}

function seedSelectOptions() {
  const clientOptions = [`<option value="all">Todos</option>`, ...state.clients.map((client) => `<option value="${client.id}">${escapeHtml(client.name)}</option>`)].join('');
  els.clientFilter.innerHTML = clientOptions;
  els.clientFilter.value = state.filters.clientId;

  const userOptions = [`<option value="all">Todos</option>`, ...state.users.map((user) => `<option value="${user.id}">${escapeHtml(user.name)}</option>`)].join('');
  els.assigneeFilter.innerHTML = userOptions;
  els.assigneeFilter.value = state.filters.assigneeId;

  document.getElementById('taskClient').innerHTML = state.clients.map((client) => `<option value="${client.id}">${escapeHtml(client.name)}</option>`).join('');
  document.getElementById('taskAssignee').innerHTML = [`<option value="">Sin asignar</option>`, ...state.users.map((user) => `<option value="${user.id}">${escapeHtml(user.name)}</option>`)].join('');
  document.getElementById('clientOwnerField').innerHTML = [`<option value="">Sin responsable</option>`, ...state.users.map((user) => `<option value="${user.id}">${escapeHtml(user.name)}</option>`)].join('');
  document.getElementById('taskStatus').innerHTML = STATUS_CONFIG.map((status) => `<option value="${status.key}">${escapeHtml(status.label)}</option>`).join('');
}

function updateTopbar() {
  const map = {
    dashboard: 'Dashboard',
    tasks: 'Tablero',
    calendar: 'Calendario',
    clients: 'Clientes',
    admin: 'Admin',
    profile: 'Mi perfil'
  };
  els.pageTitle.textContent = map[state.tab] || 'Zia WorkSpace';
  els.topbarEyebrow.textContent = state.brand.subtitle || 'Zia WorkSpace';
  document.title = `${els.pageTitle.textContent} · ${state.brand.name || 'Zia WorkSpace'}`;
  const showToolbar = ['tasks', 'dashboard', 'calendar'].includes(state.tab);
  els.toolbarSection.classList.toggle('hidden', !showToolbar);
  els.taskViewToggle.classList.toggle('hidden', state.tab !== 'tasks');
  els.newUserButton.classList.toggle('hidden', state.currentUser?.role !== 'Admin');
  els.adminNavButton.classList.toggle('hidden', state.currentUser?.role !== 'Admin');
}

function renderSidebarQuickStats() {
  const totalTasks = state.tasks.length;
  const overdueTasks = state.tasks.filter((task) => task.dueDate && task.dueDate < isoDate(new Date()) && task.status !== 'published').length;
  const approved = state.tasks.filter((task) => task.status === 'approved').length;
  const published = state.tasks.filter((task) => task.status === 'published').length;
  els.sidebarQuickStats.innerHTML = `
    <li>${totalTasks} tareas activas</li>
    <li>${state.clients.length} clientes en operación</li>
    <li>${overdueTasks} tareas vencidas</li>
    <li>${approved} aprobadas · ${published} publicadas</li>
  `;
}

function render() {
  updateTopbar();
  renderSidebarQuickStats();
  [...els.navTabs.querySelectorAll('[data-tab]')].forEach((button) => {
    button.classList.toggle('active', button.dataset.tab === state.tab);
  });

  if (state.tab === 'dashboard') return renderDashboard();
  if (state.tab === 'tasks') return renderTasks();
  if (state.tab === 'calendar') return renderCalendar();
  if (state.tab === 'clients') return renderClients();
  if (state.tab === 'admin') return renderAdmin();
  return renderProfile();
}

function renderDashboard() {
  const filtered = getFilteredTasks();
  const dueSoon = filtered.filter((task) => task.dueDate).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 6);
  const workload = state.users.map((user) => ({
    user,
    total: filtered.filter((task) => task.assigneeId === user.id && task.status !== 'published').length
  })).sort((a, b) => b.total - a.total);
  const byStatus = STATUS_CONFIG.map((status) => ({
    label: status.label,
    count: filtered.filter((task) => task.status === status.key).length
  }));
  const tasksWithAttachments = filtered.filter((task) => (task.attachments || []).length).length;

  els.workspace.innerHTML = `
    <div class="stats-grid">
      <article class="stat-card">
        <p class="small-text">Tareas filtradas</p>
        <div class="stat-value">${filtered.length}</div>
      </article>
      <article class="stat-card">
        <p class="small-text">Clientes activos</p>
        <div class="stat-value">${state.clients.length}</div>
      </article>
      <article class="stat-card">
        <p class="small-text">Con adjuntos</p>
        <div class="stat-value">${tasksWithAttachments}</div>
      </article>
      <article class="stat-card">
        <p class="small-text">Equipo</p>
        <div class="stat-value">${state.users.length}</div>
      </article>
    </div>
    <div class="dashboard-grid">
      <section class="panel">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Entregas</p>
            <h3 class="panel-title">Lo próximo</h3>
          </div>
        </div>
        <div class="list-card">
          ${dueSoon.length ? dueSoon.map((task) => `
            <div class="user-row">
              <div class="client-card-header">
                <div>
                  <strong>${escapeHtml(task.title)}</strong>
                  <div class="small-text">${escapeHtml(getClientName(task.clientId))} · ${escapeHtml(getUserName(task.assigneeId))}</div>
                </div>
                <span class="badge ${priorityClass(task.priority)}">${escapeHtml(task.priority)}</span>
              </div>
              <div class="small-text">Entrega ${escapeHtml(formatDate(task.dueDate))} · Estado ${escapeHtml(statusLabel(task.status))}</div>
            </div>
          `).join('') : `<div class="empty-state">No hay entregas con esos filtros.</div>`}
        </div>
      </section>
      <section class="panel">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Carga</p>
            <h3 class="panel-title">Carga del equipo</h3>
          </div>
        </div>
        <div class="stack-form">
          ${workload.map(({ user, total }) => `
            <div class="user-row">
              <div class="client-card-header">
                <strong>${escapeHtml(user.name)}</strong>
                <span class="badge">${total} activas</span>
              </div>
              <div class="small-text">${escapeHtml(user.role)}</div>
              <div class="progress-bar"><span style="width:${Math.min(total * 18, 100)}%"></span></div>
            </div>
          `).join('')}
        </div>
      </section>
      <section class="panel">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Pipeline</p>
            <h3 class="panel-title">Distribución por etapa</h3>
          </div>
        </div>
        <div class="stack-form">
          ${byStatus.map((status) => `
            <div class="user-row">
              <div class="client-card-header">
                <strong>${escapeHtml(status.label)}</strong>
                <span class="badge">${status.count}</span>
              </div>
              <div class="progress-bar"><span style="width:${Math.min(status.count * 14, 100)}%"></span></div>
            </div>
          `).join('')}
        </div>
      </section>
      <section class="panel">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Clientes</p>
            <h3 class="panel-title">Carga por cliente</h3>
          </div>
        </div>
        <div class="stack-form">
          ${state.clients.map((client) => {
            const total = filtered.filter((task) => task.clientId === client.id && task.status !== 'published').length;
            return `
              <div class="user-row">
                <div class="client-card-header">
                  <strong>${escapeHtml(client.name)}</strong>
                  <span class="badge">${total} tareas</span>
                </div>
                <div class="small-text">${escapeHtml(client.service || 'Sin servicio')}</div>
              </div>
            `;
          }).join('')}
        </div>
      </section>
    </div>
  `;
}

function renderTasks() {
  els.workspace.innerHTML = state.taskView === 'board' ? renderTaskBoardHtml(getFilteredTasks()) : renderTaskTableHtml(getFilteredTasks());
  bindBoardInteractions();
}

function renderTaskBoardHtml(tasks) {
  return `
    <section class="panel">
      <div class="board-grid">
        ${STATUS_CONFIG.map((status) => {
          const columnTasks = tasks.filter((task) => task.status === status.key);
          return `
            <section class="board-column" data-column-status="${status.key}">
              <div class="column-header">
                <div class="column-title"><span class="dot"></span><strong>${escapeHtml(status.label)}</strong></div>
                <span class="count-pill">${columnTasks.length}</span>
              </div>
              ${columnTasks.length ? columnTasks.map(renderTaskCard).join('') : `<div class="empty-state">Sin tareas</div>`}
            </section>
          `;
        }).join('')}
      </div>
    </section>
  `;
}

function renderTaskCard(task) {
  const checklistDone = (task.checklist || []).filter((item) => item.done).length;
  const checklistTotal = (task.checklist || []).length;
  return `
    <article class="task-card" draggable="true" data-task-id="${task.id}">
      <div class="task-card-header">
        <div>
          <h4 class="task-title">${escapeHtml(task.title)}</h4>
          <div class="small-text">${escapeHtml(getClientName(task.clientId))}</div>
        </div>
        <span class="badge ${priorityClass(task.priority)}">${escapeHtml(task.priority)}</span>
      </div>
      <p class="task-description">${escapeHtml(task.description || 'Sin descripción')}</p>
      <div class="task-meta-row">
        <div class="small-text">${escapeHtml(task.type)} · ${escapeHtml(task.channel)}</div>
        <div class="small-text">${escapeHtml(getUserName(task.assigneeId))}</div>
      </div>
      <div class="tags-row">
        <span class="task-chip">Entrega ${escapeHtml(formatDate(task.dueDate))}</span>
        ${task.publishDate ? `<span class="task-chip">Publica ${escapeHtml(formatDate(task.publishDate))}</span>` : ''}
        ${task.approvalRequired ? '<span class="task-chip">Aprobación</span>' : ''}
        ${checklistTotal ? `<span class="task-chip">Checklist ${checklistDone}/${checklistTotal}</span>` : ''}
        ${(task.attachments || []).length ? `<span class="task-chip">Adjuntos ${(task.attachments || []).length}</span>` : ''}
      </div>
      ${(task.labels || []).length ? `<div class="tags-row">${task.labels.map((label) => `<span class="badge">#${escapeHtml(label)}</span>`).join('')}</div>` : ''}
      <div class="table-actions">
        <button class="text-button" data-edit-task="${task.id}">Editar</button>
      </div>
    </article>
  `;
}

function renderTaskTableHtml(tasks) {
  return `
    <section class="panel table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Tarea</th>
            <th>Cliente</th>
            <th>Responsable</th>
            <th>Estado</th>
            <th>Entrega</th>
            <th>Adjuntos</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          ${tasks.length ? tasks.map((task) => `
            <tr>
              <td>
                <strong>${escapeHtml(task.title)}</strong>
                <div class="table-subtext">${escapeHtml(task.type)} · ${escapeHtml(task.channel)} · ${escapeHtml(task.priority)}</div>
              </td>
              <td>${escapeHtml(getClientName(task.clientId))}</td>
              <td>${escapeHtml(getUserName(task.assigneeId))}</td>
              <td><span class="badge">${escapeHtml(statusLabel(task.status))}</span></td>
              <td>${escapeHtml(formatDate(task.dueDate))}</td>
              <td>${(task.attachments || []).length}</td>
              <td>
                <div class="table-actions">
                  <button class="text-button" data-edit-task="${task.id}">Editar</button>
                  <button class="text-button" data-quick-status="${task.id}">Siguiente etapa</button>
                </div>
              </td>
            </tr>
          `).join('') : `<tr><td colspan="7"><div class="empty-state">No hay tareas con esos filtros.</div></td></tr>`}
        </tbody>
      </table>
    </section>
  `;
}

function renderCalendar() {
  const cursor = state.calendarCursor;
  const firstDay = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const startOffset = (firstDay.getDay() + 6) % 7;
  const gridStart = new Date(firstDay);
  gridStart.setDate(firstDay.getDate() - startOffset);
  const days = [];
  for (let index = 0; index < 42; index += 1) {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    const key = isoDate(date);
    const items = getFilteredTasks().filter((task) => task.publishDate === key || task.dueDate === key);
    days.push({ date, key, items, isCurrentMonth: date.getMonth() === cursor.getMonth() });
  }
  const monthLabel = new Intl.DateTimeFormat('es-DO', { month: 'long', year: 'numeric' }).format(cursor);

  els.workspace.innerHTML = `
    <section class="panel">
      <div class="calendar-head">
        <div>
          <p class="eyebrow">Calendario editorial</p>
          <h3 class="panel-title">${escapeHtml(monthLabel)}</h3>
        </div>
        <div class="table-actions">
          <button class="ghost-button" id="prevMonthButton">← Mes anterior</button>
          <button class="ghost-button" id="nextMonthButton">Mes siguiente →</button>
        </div>
      </div>
      <div class="calendar-grid">
        ${['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((day) => `<div class="small-text">${day}</div>`).join('')}
        ${days.map((day) => `
          <div class="calendar-day ${day.isCurrentMonth ? '' : 'muted'}">
            <strong>${day.date.getDate()}</strong>
            ${day.items.slice(0, 3).map((task) => `<div class="calendar-item" data-edit-task="${task.id}">${escapeHtml(task.title)}</div>`).join('')}
          </div>
        `).join('')}
      </div>
    </section>
  `;

  document.getElementById('prevMonthButton').addEventListener('click', () => {
    state.calendarCursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1);
    renderCalendar();
    bindDynamicActions();
  });
  document.getElementById('nextMonthButton').addEventListener('click', () => {
    state.calendarCursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    renderCalendar();
    bindDynamicActions();
  });
}

function renderClients() {
  els.workspace.innerHTML = `
    <div class="clients-grid">
      ${state.clients.map((client) => {
        const clientTasks = state.tasks.filter((task) => task.clientId === client.id);
        return `
          <article class="client-card">
            <div class="client-card-header">
              <div>
                <h3 class="client-name">${escapeHtml(client.name)}</h3>
                <div class="small-text">${escapeHtml(client.handle || 'Sin handle')} · ${escapeHtml(client.service || 'Sin servicio')}</div>
              </div>
              <span class="role-pill">${escapeHtml(client.status)}</span>
            </div>
            <div class="tags-row">
              <span class="badge">Plan ${escapeHtml(client.plan || 'N/D')}</span>
              <span class="badge">Responsable ${escapeHtml(getUserName(client.ownerId))}</span>
              <span class="badge">${clientTasks.length} tareas</span>
            </div>
            <div class="channels-row">
              ${(client.channels || []).map((channel) => `<span class="channel-pill">${escapeHtml(channel)}</span>`).join('')}
            </div>
            <p class="small-text">${escapeHtml(client.notes || 'Sin notas')}</p>
            <div class="table-actions">
              <button class="text-button" data-edit-client="${client.id}">Editar</button>
            </div>
          </article>
        `;
      }).join('')}
    </div>
  `;
}

function renderAdmin() {
  if (state.currentUser?.role !== 'Admin') {
    state.tab = 'dashboard';
    render();
    bindDynamicActions();
    return;
  }
  const settings = state.notificationSettings || {};
  els.workspace.innerHTML = `
    <div class="admin-grid">
      <section class="panel table-wrap">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Usuarios</p>
            <h3 class="panel-title">Equipo y accesos</h3>
          </div>
        </div>
        <table class="data-table">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Rol</th>
              <th>Estado</th>
              <th>Correo</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            ${state.users.map((user) => `
              <tr>
                <td>
                  <strong>${escapeHtml(user.name)}</strong>
                  <div class="table-subtext">Último acceso ${escapeHtml(formatDateTime(user.lastLoginAt))}</div>
                </td>
                <td>${escapeHtml(user.role)}</td>
                <td><span class="badge">${escapeHtml(user.status || 'active')}</span></td>
                <td>${escapeHtml(user.email)}</td>
                <td>
                  <div class="table-actions">
                    <button class="text-button" data-edit-user="${user.id}">Editar</button>
                    <button class="text-button" data-send-invite="${user.id}">Invitar</button>
                    <button class="text-button" data-send-reset="${user.id}">Reset email</button>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </section>
      <section class="panel">
        <div class="panel-header">
          <div>
            <p class="eyebrow">SMTP y recordatorios</p>
            <h3 class="panel-title">Ajustes de correo</h3>
          </div>
        </div>
        <form class="stack-form" id="notificationSettingsForm">
          <label class="field checkbox-row">
            <span>Activar correos automáticos</span>
            <input id="notifEnabled" type="checkbox" ${settings.enabled ? 'checked' : ''} />
          </label>
          <label class="field">
            <span>Zona horaria</span>
            <input id="notifTimezone" value="${escapeHtml(settings.timezone || 'America/Santo_Domingo')}" />
          </label>
          <label class="field checkbox-row">
            <span>Email al asignar tarea</span>
            <input id="notifAssignmentEmails" type="checkbox" ${settings.assignmentEmails ? 'checked' : ''} />
          </label>
          <label class="field checkbox-row">
            <span>Resumen diario</span>
            <input id="notifDailyDigestEnabled" type="checkbox" ${settings.dailyDigestEnabled ? 'checked' : ''} />
          </label>
          <label class="field">
            <span>Hora del resumen diario</span>
            <input id="notifDailyDigestHour" type="number" min="0" max="23" value="${Number(settings.dailyDigestHour ?? 8)}" />
          </label>
          <label class="field checkbox-row">
            <span>Enviar resumen también fines de semana</span>
            <input id="notifWeekendDigest" type="checkbox" ${settings.weekendDigest ? 'checked' : ''} />
          </label>
          <label class="field checkbox-row">
            <span>Recordatorios de tareas por vencer</span>
            <input id="notifDueSoonEnabled" type="checkbox" ${settings.dueSoonEnabled ? 'checked' : ''} />
          </label>
          <label class="field">
            <span>Ventana antes del vencimiento (horas)</span>
            <input id="notifDueSoonHours" type="number" min="1" max="240" value="${Number(settings.dueSoonHours ?? 24)}" />
          </label>
          <label class="field checkbox-row">
            <span>Recordatorios de tareas vencidas</span>
            <input id="notifOverdueEnabled" type="checkbox" ${settings.overdueEnabled ? 'checked' : ''} />
          </label>
          <label class="field">
            <span>Repetir vencidas cada (horas)</span>
            <input id="notifOverdueRepeatHours" type="number" min="1" max="240" value="${Number(settings.overdueRepeatHours ?? 24)}" />
          </label>
          <div class="table-actions">
            <button class="primary-button" type="submit">Guardar ajustes</button>
            <button class="secondary-button" id="runRemindersButton" type="button">Ejecutar recordatorios ahora</button>
          </div>
          <p class="small-text">Usa SMTP para invitaciones, recuperación y recordatorios automáticos. Si SMTP no está configurado, ZIA Flow seguirá registrando el envío en el log interno.</p>
        </form>
      </section>
      <section class="panel">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Emails</p>
            <h3 class="panel-title">Actividad reciente</h3>
          </div>
        </div>
        <div class="stack-form">
          ${state.emailLogs.length ? state.emailLogs.map((log) => `
            <article class="email-log-card">
              <div class="client-card-header">
                <strong>${escapeHtml(log.subject)}</strong>
                <span class="badge">${escapeHtml(log.mode)}</span>
              </div>
              <div class="small-text">Para ${escapeHtml(log.toEmail)} · ${escapeHtml(formatDateTime(log.createdAt))}</div>
              <p class="small-text">${escapeHtml(log.textBody.slice(0, 150))}${log.textBody.length > 150 ? '…' : ''}</p>
              ${log.previewLink ? `<a class="link-button" href="${escapeHtml(log.previewLink)}" target="_blank">Abrir enlace</a>` : ''}
            </article>
          `).join('') : `<div class="empty-state">Todavía no hay envíos registrados.</div>`}
        </div>
      </section>
    </div>
  `;
}

function renderProfile() {
  els.workspace.innerHTML = `
    <div class="profile-grid">
      <section class="panel">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Perfil</p>
            <h3 class="panel-title">Datos personales</h3>
          </div>
        </div>
        <form class="stack-form" id="profileForm">
          <label class="field">
            <span>Nombre</span>
            <input id="profileName" value="${escapeHtml(state.currentUser?.name || '')}" required />
          </label>
          <label class="field">
            <span>Correo</span>
            <input id="profileEmail" type="email" value="${escapeHtml(state.currentUser?.email || '')}" required />
          </label>
          <button class="primary-button" type="submit">Guardar perfil</button>
        </form>
      </section>
      <section class="panel">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Seguridad</p>
            <h3 class="panel-title">Cambiar contraseña</h3>
          </div>
        </div>
        <form class="stack-form" id="passwordForm">
          <label class="field">
            <span>Contraseña actual</span>
            <input id="currentPassword" type="password" required />
          </label>
          <label class="field">
            <span>Nueva contraseña</span>
            <input id="newPassword" type="password" minlength="8" required />
          </label>
          <button class="primary-button" type="submit">Actualizar contraseña</button>
        </form>
      </section>
    </div>
  `;

  document.getElementById('profileForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const result = await api('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: document.getElementById('profileName').value.trim(),
          email: document.getElementById('profileEmail').value.trim()
        })
      });
      state.currentUser = result.user;
      state.users = state.users.map((user) => user.id === result.user.id ? result.user : user);
      showToast('Perfil actualizado', 'Tus datos se guardaron correctamente.');
      renderSidebarQuickStats();
    } catch (error) {
      showToast('Error', error.message, 'error');
    }
  });

  document.getElementById('passwordForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await api('/api/profile/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: document.getElementById('currentPassword').value,
          newPassword: document.getElementById('newPassword').value
        })
      });
      event.target.reset();
      showToast('Contraseña actualizada', 'Tu contraseña fue cambiada.');
    } catch (error) {
      showToast('Error', error.message, 'error');
    }
  });
}

function openTaskModal(taskId = '') {
  const task = state.tasks.find((item) => item.id === taskId);
  els.taskModalTitle.textContent = task ? 'Editar tarea' : 'Nueva tarea';
  els.deleteTaskButton.classList.toggle('hidden', !task);
  document.getElementById('taskId').value = task?.id || '';
  document.getElementById('taskTitle').value = task?.title || '';
  document.getElementById('taskClient').value = task?.clientId || state.clients[0]?.id || '';
  document.getElementById('taskDescription').value = task?.description || '';
  document.getElementById('taskType').value = task?.type || '';
  document.getElementById('taskChannel').value = task?.channel || '';
  document.getElementById('taskFormat').value = task?.format || '';
  document.getElementById('taskAssignee').value = task?.assigneeId || '';
  document.getElementById('taskPriority').value = task?.priority || 'Media';
  document.getElementById('taskStatus').value = task?.status || 'brief';
  document.getElementById('taskDueDate').value = task?.dueDate || '';
  document.getElementById('taskPublishDate').value = task?.publishDate || '';
  document.getElementById('taskApproval').checked = Boolean(task?.approvalRequired);
  document.getElementById('taskLabels').value = (task?.labels || []).join(', ');
  document.getElementById('taskChecklist').value = (task?.checklist || []).map((item) => item.text).join('\n');
  document.getElementById('taskComment').value = '';
  document.getElementById('taskFiles').value = '';
  renderTaskAttachments(task);
  els.taskModalBackdrop.classList.remove('hidden');
}

function renderTaskAttachments(task) {
  const container = document.getElementById('taskAttachmentList');
  if (!task || !(task.attachments || []).length) {
    container.innerHTML = `<div class="empty-state">Guarda la tarea y luego agrega adjuntos, o súbelos ahora si ya estás editando.</div>`;
    return;
  }
  container.innerHTML = task.attachments.map((attachment) => `
    <div class="attachment-item">
      <a class="link-button" href="/api/attachments/${attachment.id}/download" target="_blank">${escapeHtml(attachment.originalName)}</a>
      <span class="small-text">${Math.round((attachment.sizeBytes || 0) / 1024)} KB</span>
      <button class="text-button" type="button" data-delete-attachment="${attachment.id}">Quitar</button>
    </div>
  `).join('');
}

function closeTaskModal() {
  els.taskModalBackdrop.classList.add('hidden');
  els.taskForm.reset();
}

function openClientModal(clientId = '') {
  const client = state.clients.find((item) => item.id === clientId);
  els.clientModalTitle.textContent = client ? 'Editar cliente' : 'Nuevo cliente';
  els.deleteClientButton.classList.toggle('hidden', !client);
  document.getElementById('clientIdField').value = client?.id || '';
  document.getElementById('clientNameField').value = client?.name || '';
  document.getElementById('clientHandleField').value = client?.handle || '';
  document.getElementById('clientServiceField').value = client?.service || '';
  document.getElementById('clientPlanField').value = client?.plan || '';
  document.getElementById('clientOwnerField').value = client?.ownerId || '';
  document.getElementById('clientStatusField').value = client?.status || 'Activo';
  document.getElementById('clientChannelsField').value = (client?.channels || []).join(', ');
  document.getElementById('clientNotesField').value = client?.notes || '';
  els.clientModalBackdrop.classList.remove('hidden');
}

function closeClientModal() {
  els.clientModalBackdrop.classList.add('hidden');
  els.clientForm.reset();
}

function openUserModal(userId = '') {
  const user = state.users.find((item) => item.id === userId);
  els.userModalTitle.textContent = user ? 'Editar usuario' : 'Nuevo usuario';
  document.getElementById('userIdField').value = user?.id || '';
  document.getElementById('userNameField').value = user?.name || '';
  document.getElementById('userEmailField').value = user?.email || '';
  document.getElementById('userRoleField').value = user?.role || 'Colaborador';
  document.getElementById('userStatusField').value = user?.status || 'active';
  document.getElementById('userAccentField').value = user?.accent || 'default';
  document.getElementById('userPasswordField').value = '';
  document.getElementById('userSendInviteField').checked = !user;
  els.userModalBackdrop.classList.remove('hidden');
}

function closeUserModal() {
  els.userModalBackdrop.classList.add('hidden');
  els.userForm.reset();
}

async function saveTaskFromForm() {
  const taskId = document.getElementById('taskId').value;
  const original = state.tasks.find((task) => task.id === taskId);
  const payload = {
    id: taskId || undefined,
    title: document.getElementById('taskTitle').value.trim(),
    description: document.getElementById('taskDescription').value.trim(),
    clientId: document.getElementById('taskClient').value,
    type: document.getElementById('taskType').value.trim() || 'General',
    channel: document.getElementById('taskChannel').value.trim() || 'General',
    format: document.getElementById('taskFormat').value.trim(),
    assigneeId: document.getElementById('taskAssignee').value,
    priority: document.getElementById('taskPriority').value,
    status: document.getElementById('taskStatus').value,
    dueDate: document.getElementById('taskDueDate').value,
    publishDate: document.getElementById('taskPublishDate').value,
    approvalRequired: document.getElementById('taskApproval').checked,
    labels: document.getElementById('taskLabels').value.split(',').map((item) => item.trim()).filter(Boolean),
    checklist: parseLinesToChecklist(document.getElementById('taskChecklist').value, original?.checklist || []),
    comments: [
      ...(original?.comments || []),
      ...(() => {
        const commentText = document.getElementById('taskComment').value.trim();
        if (!commentText) return [];
        return [{ text: commentText, authorId: state.currentUser.id, createdAt: new Date().toISOString() }];
      })()
    ],
    createdAt: original?.createdAt,
    createdById: original?.createdById || state.currentUser.id
  };

  const endpoint = taskId ? `/api/tasks/${taskId}` : '/api/tasks';
  const method = taskId ? 'PATCH' : 'POST';
  const savedTask = await api(endpoint, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const files = [...document.getElementById('taskFiles').files];
  for (const file of files) {
    const formData = new FormData();
    formData.append('file', file);
    const attachment = await api(`/api/tasks/${savedTask.id}/attachments`, {
      method: 'POST',
      body: formData
    });
    savedTask.attachments = [...(savedTask.attachments || []), attachment];
  }

  if (taskId) {
    state.tasks = state.tasks.map((task) => task.id === savedTask.id ? savedTask : task);
  } else {
    state.tasks.unshift(savedTask);
  }
  showToast('Tarea guardada', 'La tarea fue actualizada correctamente.');
}

async function saveClientFromForm() {
  const clientId = document.getElementById('clientIdField').value;
  const payload = {
    id: clientId || undefined,
    name: document.getElementById('clientNameField').value.trim(),
    handle: document.getElementById('clientHandleField').value.trim(),
    service: document.getElementById('clientServiceField').value.trim(),
    plan: document.getElementById('clientPlanField').value.trim(),
    ownerId: document.getElementById('clientOwnerField').value,
    status: document.getElementById('clientStatusField').value,
    channels: document.getElementById('clientChannelsField').value.split(',').map((item) => item.trim()).filter(Boolean),
    notes: document.getElementById('clientNotesField').value.trim()
  };
  const endpoint = clientId ? `/api/clients/${clientId}` : '/api/clients';
  const method = clientId ? 'PATCH' : 'POST';
  const client = await api(endpoint, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (clientId) {
    state.clients = state.clients.map((item) => item.id === client.id ? client : item);
  } else {
    state.clients.unshift(client);
  }
  seedSelectOptions();
  showToast('Cliente guardado', 'El cliente fue actualizado.');
}

async function saveUserFromForm() {
  const userId = document.getElementById('userIdField').value;
  const payload = {
    name: document.getElementById('userNameField').value.trim(),
    email: document.getElementById('userEmailField').value.trim(),
    role: document.getElementById('userRoleField').value,
    status: document.getElementById('userStatusField').value,
    accent: document.getElementById('userAccentField').value,
    password: document.getElementById('userPasswordField').value,
    sendInvite: document.getElementById('userSendInviteField').checked
  };
  const endpoint = userId ? `/api/admin/users/${userId}` : '/api/admin/users';
  const method = userId ? 'PATCH' : 'POST';
  const result = await api(endpoint, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const user = result.user || result;
  if (userId) {
    state.users = state.users.map((item) => item.id === user.id ? user : item);
  } else {
    state.users.push(user);
  }
  seedSelectOptions();
  showToast('Usuario guardado', result.previewLink ? `Invitación lista. ${result.previewLink}` : 'Los cambios fueron guardados.');
}

function bindBoardInteractions() {
  document.querySelectorAll('[data-task-id]').forEach((card) => {
    card.addEventListener('dragstart', () => {
      state.dragTaskId = card.dataset.taskId;
    });
  });
  document.querySelectorAll('[data-column-status]').forEach((column) => {
    column.addEventListener('dragover', (event) => {
      event.preventDefault();
      column.classList.add('drag-over');
    });
    column.addEventListener('dragleave', () => column.classList.remove('drag-over'));
    column.addEventListener('drop', async (event) => {
      event.preventDefault();
      column.classList.remove('drag-over');
      if (!state.dragTaskId) return;
      const task = state.tasks.find((item) => item.id === state.dragTaskId);
      if (!task || task.status === column.dataset.columnStatus) return;
      try {
        const updated = await api(`/api/tasks/${task.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...task, status: column.dataset.columnStatus })
        });
        state.tasks = state.tasks.map((item) => item.id === updated.id ? updated : item);
        render();
        bindDynamicActions();
      } catch (error) {
        showToast('Error', error.message, 'error');
      } finally {
        state.dragTaskId = '';
      }
    });
  });
}

function bindDynamicActions() {
  document.querySelectorAll('[data-edit-task]').forEach((button) => {
    button.addEventListener('click', () => openTaskModal(button.dataset.editTask));
  });
  document.querySelectorAll('[data-quick-status]').forEach((button) => {
    button.addEventListener('click', async () => {
      const task = state.tasks.find((item) => item.id === button.dataset.quickStatus);
      if (!task) return;
      const currentIndex = STATUS_CONFIG.findIndex((item) => item.key === task.status);
      const nextStatus = STATUS_CONFIG[Math.min(currentIndex + 1, STATUS_CONFIG.length - 1)].key;
      try {
        const updated = await api(`/api/tasks/${task.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...task, status: nextStatus })
        });
        state.tasks = state.tasks.map((item) => item.id === updated.id ? updated : item);
        render();
        bindDynamicActions();
      } catch (error) {
        showToast('Error', error.message, 'error');
      }
    });
  });
  document.querySelectorAll('[data-edit-client]').forEach((button) => {
    button.addEventListener('click', () => openClientModal(button.dataset.editClient));
  });
  document.querySelectorAll('[data-edit-user]').forEach((button) => {
    button.addEventListener('click', () => openUserModal(button.dataset.editUser));
  });
  document.querySelectorAll('[data-send-invite]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        const result = await api(`/api/admin/users/${button.dataset.sendInvite}/invite`, { method: 'POST' });
        await refreshBootstrap();
        showToast('Invitación enviada', result.previewLink || 'El correo de invitación fue procesado.');
      } catch (error) {
        showToast('Error', error.message, 'error');
      }
    });
  });
  document.querySelectorAll('[data-send-reset]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        const result = await api(`/api/admin/users/${button.dataset.sendReset}/password-reset`, { method: 'POST' });
        await refreshBootstrap();
        showToast('Reset enviado', result.previewLink || 'El correo de recuperación fue procesado.');
      } catch (error) {
        showToast('Error', error.message, 'error');
      }
    });
  });
  const notificationSettingsForm = document.getElementById('notificationSettingsForm');
  if (notificationSettingsForm) {
    notificationSettingsForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        const payload = {
          enabled: document.getElementById('notifEnabled').checked,
          timezone: document.getElementById('notifTimezone').value.trim() || 'America/Santo_Domingo',
          assignmentEmails: document.getElementById('notifAssignmentEmails').checked,
          dailyDigestEnabled: document.getElementById('notifDailyDigestEnabled').checked,
          dailyDigestHour: Number(document.getElementById('notifDailyDigestHour').value || 8),
          weekendDigest: document.getElementById('notifWeekendDigest').checked,
          dueSoonEnabled: document.getElementById('notifDueSoonEnabled').checked,
          dueSoonHours: Number(document.getElementById('notifDueSoonHours').value || 24),
          overdueEnabled: document.getElementById('notifOverdueEnabled').checked,
          overdueRepeatHours: Number(document.getElementById('notifOverdueRepeatHours').value || 24)
        };
        state.notificationSettings = await api('/api/admin/notification-settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        showToast('Ajustes guardados', 'Los correos automáticos quedaron actualizados.');
        await refreshBootstrap();
      } catch (error) {
        showToast('Error', error.message, 'error');
      }
    });
  }
  const runRemindersButton = document.getElementById('runRemindersButton');
  if (runRemindersButton) {
    runRemindersButton.addEventListener('click', async () => {
      try {
        const result = await api('/api/admin/reminders/run', { method: 'POST' });
        await refreshBootstrap();
        showToast('Recordatorios ejecutados', `Enviados: ${result.sent || 0} · Omitidos: ${result.skipped || 0}`);
      } catch (error) {
        showToast('Error', error.message, 'error');
      }
    });
  }
  document.querySelectorAll('[data-delete-attachment]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await api(`/api/attachments/${button.dataset.deleteAttachment}`, { method: 'DELETE' });
        const currentTaskId = document.getElementById('taskId').value;
        const task = state.tasks.find((item) => item.id === currentTaskId);
        if (task) {
          task.attachments = (task.attachments || []).filter((item) => item.id !== button.dataset.deleteAttachment);
          renderTaskAttachments(task);
        }
        showToast('Adjunto eliminado', 'El archivo fue removido.');
      } catch (error) {
        showToast('Error', error.message, 'error');
      }
    });
  });
}

async function refreshBootstrap() {
  const data = await api('/api/bootstrap');
  state.brand = { ...data.brand, name: 'Zia WorkSpace', subtitle: 'Zia Lab Agency' };
  state.currentUser = data.currentUser;
  state.users = data.users;
  state.clients = data.clients;
  state.tasks = data.tasks;
  state.emailLogs = data.emailLogs || [];
  state.notificationSettings = data.notificationSettings || state.notificationSettings;
  seedSelectOptions();
  render();
  bindDynamicActions();
}

async function handleSessionBoot() {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get('mode');
  const token = params.get('token');
  if (mode && token && ['invite', 'reset'].includes(mode)) {
    state.authMode = 'token';
    state.tokenMode = mode;
    state.tokenValue = token;
    activateAuthView('token');
    try {
      const result = await api(`/api/auth/token-status?token=${encodeURIComponent(token)}`);
      els.tokenIntro.innerHTML = `
        <strong>${mode === 'invite' ? 'Activa tu usuario' : 'Cambia tu contraseña'}</strong>
        <span>${escapeHtml(result.email)}</span>
        <span>Vence: ${escapeHtml(formatDateTime(result.expiresAt))}</span>
      `;
      document.getElementById('tokenName').value = result.name || '';
      els.tokenNameFieldWrap.classList.toggle('hidden', mode !== 'invite');
      els.tokenButton.textContent = mode === 'invite' ? 'Activar cuenta y entrar' : 'Guardar nueva contraseña';
    } catch (error) {
      els.tokenIntro.innerHTML = `<strong>Enlace inválido</strong><span>${escapeHtml(error.message)}</span>`;
      els.tokenNameFieldWrap.classList.add('hidden');
      els.tokenButton.disabled = true;
    }
    return;
  }

  try {
    const session = await api('/api/auth/session');
    state.currentUser = session.user;
    await refreshBootstrap();
    els.authShell.classList.add('hidden');
    els.appShell.classList.remove('hidden');
  } catch (_error) {
    activateAuthView('login');
  }
}

function openSidebar() {
  if (!els.appShell) return;
  els.appShell.classList.add('sidebar-open');
  if (els.sidebarScrim) els.sidebarScrim.classList.remove('hidden');
}

function closeSidebar() {
  if (!els.appShell) return;
  els.appShell.classList.remove('sidebar-open');
  if (els.sidebarScrim) els.sidebarScrim.classList.add('hidden');
}

function activateAuthView(view) {
  state.authMode = view;
  if (els.authPanels) {
    els.authPanels.dataset.activeView = view;
  }

  const authTabs = [...document.querySelectorAll('.auth-tab')];
  authTabs.forEach((button) => {
    const isActive = button.dataset.authView === view;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-selected', isActive ? 'true' : 'false');
    button.tabIndex = isActive ? 0 : -1;
  });

  const panels = [
    { el: els.loginView, active: view === 'login' },
    { el: els.forgotView, active: view === 'forgot' },
    { el: els.tokenView, active: view === 'token' }
  ];

  panels.forEach(({ el, active }) => {
    if (!el) return;
    el.classList.toggle('active', active);
    if (active) {
      el.removeAttribute('hidden');
    } else {
      el.setAttribute('hidden', 'hidden');
    }
  });

  if (view === 'login') {
    document.getElementById('loginEmail')?.focus({ preventScroll: true });
  }
  if (view === 'forgot') {
    document.getElementById('forgotEmail')?.focus({ preventScroll: true });
  }
}

function openApp() {
  els.authShell.classList.add('hidden');
  els.appShell.classList.remove('hidden');
}

function closeAllModals() {
  closeTaskModal();
  closeClientModal();
  closeUserModal();
}

function bindStaticEvents() {
  document.querySelectorAll('.auth-tab').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      const view = button.dataset.authView;
      if (!view) return;
      activateAuthView(view);
    });
  });

  els.mobileMenuButton?.addEventListener('click', openSidebar);
  els.sidebarCloseButton?.addEventListener('click', closeSidebar);
  els.sidebarScrim?.addEventListener('click', closeSidebar);

  els.loginView.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const result = await api('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: document.getElementById('loginEmail').value.trim(),
          password: document.getElementById('loginPassword').value
        })
      });
      state.currentUser = result.user;
      await refreshBootstrap();
      openApp();
    } catch (error) {
      showToast('Acceso fallido', error.message, 'error');
    }
  });

  els.forgotView.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const result = await api('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: document.getElementById('forgotEmail').value.trim() })
      });
      showToast('Solicitud procesada', result.previewLink || result.message);
      if (result.previewLink) {
        window.open(result.previewLink, '_self');
      }
    } catch (error) {
      showToast('Error', error.message, 'error');
    }
  });

  els.tokenView.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const result = await api('/api/auth/complete-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: state.tokenValue,
          name: document.getElementById('tokenName').value.trim(),
          password: document.getElementById('tokenPassword').value
        })
      });
      state.currentUser = result.user;
      history.replaceState({}, '', '/');
      await refreshBootstrap();
      openApp();
      showToast('Acceso activo', 'Tu usuario ya quedó listo.');
    } catch (error) {
      showToast('Error', error.message, 'error');
    }
  });

  els.navTabs.addEventListener('click', (event) => {
    const button = event.target.closest('[data-tab]');
    if (!button) return;
    state.tab = button.dataset.tab;
    render();
    bindDynamicActions();
    closeSidebar();
  });

  els.newTaskButton.addEventListener('click', () => openTaskModal());
  els.newClientButton.addEventListener('click', () => openClientModal());
  els.newUserButton.addEventListener('click', () => openUserModal());
  els.logoutButton.addEventListener('click', async () => {
    closeSidebar();
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch (_error) {
      // ignore
    }
    window.location.href = '/';
  });

  els.globalSearch.addEventListener('input', (event) => {
    state.filters.search = event.target.value;
    render();
    bindDynamicActions();
  });
  els.clientFilter.addEventListener('change', (event) => {
    state.filters.clientId = event.target.value;
    render();
    bindDynamicActions();
  });
  els.assigneeFilter.addEventListener('change', (event) => {
    state.filters.assigneeId = event.target.value;
    render();
    bindDynamicActions();
  });
  els.priorityFilter.addEventListener('change', (event) => {
    state.filters.priority = event.target.value;
    render();
    bindDynamicActions();
  });

  els.taskViewToggle.addEventListener('click', (event) => {
    const button = event.target.closest('[data-view]');
    if (!button) return;
    state.taskView = button.dataset.view;
    [...els.taskViewToggle.querySelectorAll('[data-view]')].forEach((item) => item.classList.toggle('active', item === button));
    render();
    bindDynamicActions();
  });

  document.querySelectorAll('[data-close-modal]').forEach((button) => {
    button.addEventListener('click', closeAllModals);
  });
  [els.taskModalBackdrop, els.clientModalBackdrop, els.userModalBackdrop].forEach((backdrop) => {
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) closeAllModals();
    });
  });

  els.taskForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await saveTaskFromForm();
      closeTaskModal();
      render();
      bindDynamicActions();
    } catch (error) {
      showToast('Error', error.message, 'error');
    }
  });

  els.clientForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await saveClientFromForm();
      closeClientModal();
      render();
      bindDynamicActions();
    } catch (error) {
      showToast('Error', error.message, 'error');
    }
  });

  els.userForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await saveUserFromForm();
      closeUserModal();
      await refreshBootstrap();
    } catch (error) {
      showToast('Error', error.message, 'error');
    }
  });

  els.deleteTaskButton.addEventListener('click', async () => {
    const taskId = document.getElementById('taskId').value;
    if (!taskId) return;
    if (!confirm('¿Seguro que quieres eliminar esta tarea?')) return;
    try {
      await api(`/api/tasks/${taskId}`, { method: 'DELETE' });
      state.tasks = state.tasks.filter((task) => task.id !== taskId);
      closeTaskModal();
      render();
      bindDynamicActions();
      showToast('Tarea eliminada', 'La tarea fue borrada del sistema.');
    } catch (error) {
      showToast('Error', error.message, 'error');
    }
  });

  els.deleteClientButton.addEventListener('click', async () => {
    const clientId = document.getElementById('clientIdField').value;
    if (!clientId) return;
    if (!confirm('¿Seguro que quieres eliminar este cliente?')) return;
    try {
      await api(`/api/clients/${clientId}`, { method: 'DELETE' });
      state.clients = state.clients.filter((client) => client.id !== clientId);
      closeClientModal();
      seedSelectOptions();
      render();
      bindDynamicActions();
      showToast('Cliente eliminado', 'El cliente fue eliminado.');
    } catch (error) {
      showToast('Error', error.message, 'error');
    }
  });
}

bindStaticEvents();
handleSessionBoot();
