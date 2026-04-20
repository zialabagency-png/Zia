const STATUS_CONFIG = [
  { key: 'not_started', label: 'Sin iniciar' },
  { key: 'in_progress', label: 'En proceso' },
  { key: 'review', label: 'Revisión' },
  { key: 'sent', label: 'Enviado' },
  { key: 'approved', label: 'Aprobado' },
  { key: 'scheduled', label: 'Programado' }
];

const WORK_STATUS_CONFIG = [
  { key: 'available', label: 'Disponible' },
  { key: 'focus', label: 'En foco' },
  { key: 'meeting', label: 'En reunión' },
  { key: 'break', label: 'En pausa' },
  { key: 'offline', label: 'Desconectado' }
];

const state = {
  brand: { name: 'ZIA Flow', subtitle: 'Agency Workspace' },
  currentUser: null,
  users: [],
  clients: [],
  tasks: [],
  emailLogs: [],
  workSessions: [],
  activityLogs: [],
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

function statusClass(key) {
  return `status-${key}`;
}

function uniqueIds(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map((item) => String(item || '').trim()).filter(Boolean))];
}

function getTaskAssigneeIds(task) {
  const direct = uniqueIds(task?.assigneeIds || []);
  if (direct.length) return direct;
  return uniqueIds([task?.assigneeId]);
}

function getTaskSubtasks(task) {
  return Array.isArray(task?.subtasks) ? task.subtasks : [];
}

function isTaskCompleted(task) {
  return task?.status === 'scheduled';
}

function getTaskDueReference(task) {
  const dates = [task?.dueDate, ...getTaskSubtasks(task).map((item) => item.dueDate)].filter(Boolean).sort();
  return dates[0] || '';
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

function getUserNames(ids = []) {
  const names = uniqueIds(ids).map((id) => getUserName(id)).filter(Boolean);
  return names.length ? names.join(', ') : 'Sin asignar';
}

function getTaskAssigneeNames(task) {
  return getUserNames(getTaskAssigneeIds(task));
}

function taskMatchesAssignee(task, userId) {
  return getTaskAssigneeIds(task).includes(userId) || getTaskSubtasks(task).some((subtask) => subtask.assigneeId === userId);
}

function getSubtaskSummary(task) {
  const subtasks = getTaskSubtasks(task);
  const completed = subtasks.filter((item) => item.status === 'scheduled').length;
  return { total: subtasks.length, completed };
}

function todayKey() {
  return isoDate(new Date());
}

function workStatusLabel(key) {
  return WORK_STATUS_CONFIG.find((item) => item.key === key)?.label || 'Disponible';
}

function workStatusClass(key) {
  return `work-${key || 'available'}`;
}

function getTodaySession(userId) {
  return (state.workSessions || []).find((session) => session.userId === userId && session.dateKey === todayKey()) || null;
}

function getUserActivityLogs(userId, limit = 8) {
  return (state.activityLogs || []).filter((item) => item.userId === userId).slice(0, limit);
}

function getUserRemoteMetrics(userId) {
  const openTasks = state.tasks.filter((task) => taskMatchesAssignee(task, userId) && !isTaskCompleted(task));
  const overdue = openTasks.filter((task) => task.dueDate && task.dueDate < todayKey());
  const openSubtasks = state.tasks.flatMap((task) => getTaskSubtasks(task).filter((subtask) => subtask.assigneeId === userId && subtask.status !== 'scheduled'));
  const completedSubtasks = state.tasks.flatMap((task) => getTaskSubtasks(task).filter((subtask) => subtask.assigneeId === userId && subtask.status === 'scheduled'));
  return {
    openTasks: openTasks.length,
    overdueTasks: overdue.length,
    openSubtasks: openSubtasks.length,
    completedSubtasks: completedSubtasks.length,
    lastActivity: getUserActivityLogs(userId, 1)[0] || null,
    todaySession: getTodaySession(userId)
  };
}

function getSessionWorkedLabel(session) {
  if (!session?.checkInAt) return 'Sin entrada';
  const start = new Date(session.checkInAt).getTime();
  const end = session.checkOutAt ? new Date(session.checkOutAt).getTime() : Date.now();
  const diff = Math.max(0, end - start);
  const totalMinutes = Math.round(diff / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes.toString().padStart(2, '0')}m`;
}

function renderWorkStatusOptions(selected = 'available') {
  return WORK_STATUS_CONFIG.map((status) => `<option value="${status.key}" ${status.key === selected ? 'selected' : ''}>${escapeHtml(status.label)}</option>`).join('');
}

function renderStatusOptions(selected = '') {
  return STATUS_CONFIG.map((status) => `<option value="${status.key}" ${status.key === selected ? 'selected' : ''}>${escapeHtml(status.label)}</option>`).join('');
}

function renderAssigneeCheckboxes(selectedIds = []) {
  return state.users.map((user) => {
    const checked = selectedIds.includes(user.id) ? 'checked' : '';
    return `<label class="assignee-check-item"><input type="checkbox" value="${user.id}" ${checked} /><span>${escapeHtml(user.name)}</span><small>${escapeHtml(user.role)}</small></label>`;
  }).join('');
}

function getSelectedTaskAssignees() {
  return [...document.querySelectorAll('#taskAssigneesBox input[type="checkbox"]:checked')].map((input) => input.value);
}

function buildSubtaskRow(subtask = {}) {
  return `
    <div class="subtask-editor-row" data-subtask-row>
      <input type="hidden" data-subtask-id value="${escapeHtml(subtask.id || '')}" />
      <label class="field">
        <span>Subtarea</span>
        <input data-subtask-title value="${escapeHtml(subtask.title || '')}" placeholder="Ej: Copies del calendario" />
      </label>
      <label class="field">
        <span>Responsable</span>
        <select data-subtask-assignee>
          <option value="">Sin asignar</option>
          ${state.users.map((user) => `<option value="${user.id}" ${subtask.assigneeId === user.id ? 'selected' : ''}>${escapeHtml(user.name)}</option>`).join('')}
        </select>
      </label>
      <label class="field">
        <span>Entrega</span>
        <input data-subtask-due type="date" value="${escapeHtml(subtask.dueDate || '')}" />
      </label>
      <label class="field">
        <span>Estado</span>
        <select data-subtask-status>
          ${renderStatusOptions(subtask.status || 'not_started')}
        </select>
      </label>
      <label class="field full-row">
        <span>Entregable / nota</span>
        <input data-subtask-deliverable value="${escapeHtml(subtask.deliverable || '')}" placeholder="Ej: Artes finales o documento de copies" />
      </label>
      <div class="subtask-row-actions">
        <button class="ghost-button small-button" type="button" data-remove-subtask>Quitar</button>
      </div>
    </div>
  `;
}

function renderTaskSubtasksEditor(task = null) {
  const container = document.getElementById('taskSubtasksList');
  const subtasks = getTaskSubtasks(task);
  container.innerHTML = subtasks.length ? subtasks.map((subtask) => buildSubtaskRow(subtask)).join('') : '<div class="empty-state compact-empty">Agrega subtareas para copies, diseño, revisión o entregables internos.</div>';
  bindSubtaskEditorActions();
}

function addSubtaskRow(subtask = {}) {
  const container = document.getElementById('taskSubtasksList');
  if (container.querySelector('.compact-empty')) container.innerHTML = '';
  container.insertAdjacentHTML('beforeend', buildSubtaskRow(subtask));
  bindSubtaskEditorActions();
}

function bindSubtaskEditorActions() {
  document.querySelectorAll('[data-remove-subtask]').forEach((button) => {
    button.onclick = () => {
      const row = button.closest('[data-subtask-row]');
      row?.remove();
      const container = document.getElementById('taskSubtasksList');
      if (container && !container.querySelector('[data-subtask-row]')) {
        container.innerHTML = '<div class="empty-state compact-empty">Agrega subtareas para copies, diseño, revisión o entregables internos.</div>';
      }
    };
  });
}

function collectSubtasksFromForm(originalSubtasks = []) {
  return [...document.querySelectorAll('[data-subtask-row]')].map((row) => {
    const title = row.querySelector('[data-subtask-title]').value.trim();
    if (!title) return null;
    const existing = originalSubtasks.find((item) => item.id === row.querySelector('[data-subtask-id]').value);
    return {
      id: existing?.id || row.querySelector('[data-subtask-id]').value || `st_${Math.random().toString(16).slice(2, 10)}`,
      title,
      assigneeId: row.querySelector('[data-subtask-assignee]').value,
      dueDate: row.querySelector('[data-subtask-due]').value,
      status: row.querySelector('[data-subtask-status]').value,
      deliverable: row.querySelector('[data-subtask-deliverable]').value.trim(),
      createdAt: existing?.createdAt,
      updatedAt: new Date().toISOString()
    };
  }).filter(Boolean);
}

function renderSubtaskPreview(task) {
  const subtasks = getTaskSubtasks(task);
  if (!subtasks.length) return '';
  return `
    <div class="subtask-preview-list">
      ${subtasks.slice(0, 3).map((subtask) => `
        <div class="subtask-preview-item ${statusClass(subtask.status)}">
          <strong>${escapeHtml(subtask.title)}</strong>
          <span>${escapeHtml(getUserName(subtask.assigneeId))} · ${escapeHtml(formatDate(subtask.dueDate))}</span>
        </div>
      `).join('')}
      ${subtasks.length > 3 ? `<div class="small-text">+${subtasks.length - 3} subtareas más</div>` : ''}
    </div>
  `;
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
    if (state.filters.assigneeId !== 'all' && !taskMatchesAssignee(task, state.filters.assigneeId)) return false;
    if (state.filters.priority !== 'all' && task.priority !== state.filters.priority) return false;
    const haystack = [
      task.title,
      task.description,
      getClientName(task.clientId),
      getTaskAssigneeNames(task),
      ...(task.labels || []),
      ...getTaskSubtasks(task).flatMap((subtask) => [subtask.title, subtask.deliverable, getUserName(subtask.assigneeId)])
    ].join(' ').toLowerCase();
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
  document.getElementById('taskAssigneesBox').innerHTML = renderAssigneeCheckboxes([]);
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
  els.pageTitle.textContent = map[state.tab] || 'ZIA Flow';
  els.topbarEyebrow.textContent = state.brand.subtitle || 'ZIA Lab';
  const showToolbar = ['tasks', 'dashboard', 'calendar'].includes(state.tab);
  els.toolbarSection.classList.toggle('hidden', !showToolbar);
  els.taskViewToggle.classList.toggle('hidden', state.tab !== 'tasks');
  els.newUserButton.classList.toggle('hidden', state.currentUser?.role !== 'Admin');
  els.adminNavButton.classList.toggle('hidden', state.currentUser?.role !== 'Admin');
}

function renderSidebarQuickStats() {
  const totalTasks = state.tasks.length;
  const overdueTasks = state.tasks.filter((task) => task.dueDate && task.dueDate < isoDate(new Date()) && !isTaskCompleted(task)).length;
  const approved = state.tasks.filter((task) => task.status === 'approved').length;
  const scheduled = state.tasks.filter((task) => task.status === 'scheduled').length;
  const checkedIn = state.currentUser?.role === 'Admin' ? state.users.filter((user) => getTodaySession(user.id)?.checkInAt).length : 0;
  els.sidebarQuickStats.innerHTML = `
    <li>${totalTasks} tareas activas</li>
    <li>${state.clients.length} clientes en operación</li>
    <li>${overdueTasks} tareas vencidas</li>
    <li>${approved} aprobadas · ${scheduled} programadas</li>
    ${state.currentUser?.role === 'Admin' ? `<li>${checkedIn}/${state.users.length} con entrada hoy</li>` : ''}
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
  const dueSoon = filtered
    .filter((task) => getTaskDueReference(task))
    .sort((a, b) => getTaskDueReference(a).localeCompare(getTaskDueReference(b)))
    .slice(0, 6);
  const workload = state.users.map((user) => ({
    user,
    total: filtered.filter((task) => taskMatchesAssignee(task, user.id) && !isTaskCompleted(task)).length
  })).sort((a, b) => b.total - a.total);
  const byStatus = STATUS_CONFIG.map((status) => ({
    label: status.label,
    key: status.key,
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
                  <div class="small-text">${escapeHtml(getClientName(task.clientId))} · ${escapeHtml(getTaskAssigneeNames(task))}</div>
                </div>
                <span class="badge ${priorityClass(task.priority)}">${escapeHtml(task.priority)}</span>
              </div>
              <div class="small-text">Entrega ${escapeHtml(formatDate(getTaskDueReference(task)))} · Estado <span class="badge stage-badge ${statusClass(task.status)}">${escapeHtml(statusLabel(task.status))}</span></div>
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
                <span class="badge stage-badge ${statusClass(status.key)}">${status.count}</span>
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
            const total = filtered.filter((task) => task.clientId === client.id && !isTaskCompleted(task)).length;
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
      <div class="board-grid six-columns">
        ${STATUS_CONFIG.map((status) => {
          const columnTasks = tasks.filter((task) => task.status === status.key);
          return `
            <section class="board-column ${statusClass(status.key)}" data-column-status="${status.key}">
              <div class="column-header">
                <div class="column-title"><span class="dot ${statusClass(status.key)}"></span><strong>${escapeHtml(status.label)}</strong></div>
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
  const subtaskSummary = getSubtaskSummary(task);
  return `
    <article class="task-card ${statusClass(task.status)}" draggable="true" data-task-id="${task.id}">
      <div class="task-card-header">
        <div>
          <h4 class="task-title">${escapeHtml(task.title)}</h4>
          <div class="small-text">${escapeHtml(getClientName(task.clientId))}</div>
        </div>
        <span class="badge ${priorityClass(task.priority)}">${escapeHtml(task.priority)}</span>
      </div>
      <div class="task-meta-top">
        <span class="badge stage-badge ${statusClass(task.status)}">${escapeHtml(statusLabel(task.status))}</span>
        <div class="small-text">Responsables: ${escapeHtml(getTaskAssigneeNames(task))}</div>
      </div>
      <p class="task-description">${escapeHtml(task.description || 'Sin descripción')}</p>
      <div class="task-meta-row">
        <div class="small-text">${escapeHtml(task.type)} · ${escapeHtml(task.channel)}</div>
        <div class="small-text">Entrega ${escapeHtml(formatDate(getTaskDueReference(task) || task.dueDate))}</div>
      </div>
      <div class="tags-row">
        ${task.publishDate ? `<span class="task-chip">Publica ${escapeHtml(formatDate(task.publishDate))}</span>` : ''}
        ${task.approvalRequired ? '<span class="task-chip">Aprobación</span>' : ''}
        ${checklistTotal ? `<span class="task-chip">Checklist ${checklistDone}/${checklistTotal}</span>` : ''}
        ${subtaskSummary.total ? `<span class="task-chip">Subtareas ${subtaskSummary.completed}/${subtaskSummary.total}</span>` : ''}
        ${(task.attachments || []).length ? `<span class="task-chip">Adjuntos ${(task.attachments || []).length}</span>` : ''}
      </div>
      ${renderSubtaskPreview(task)}
      ${(task.labels || []).length ? `<div class="tags-row">${task.labels.map((label) => `<span class="badge">#${escapeHtml(label)}</span>`).join('')}</div>` : ''}
      <div class="task-card-footer">
        <label class="inline-status-wrap">
          <span class="small-text">Estado</span>
          <select class="inline-status-select ${statusClass(task.status)}" data-task-status-select="${task.id}">
            ${renderStatusOptions(task.status)}
          </select>
        </label>
        <button class="text-button" data-edit-task="${task.id}">Editar</button>
      </div>
    </article>
  `;
}

function renderTaskTableHtml(tasks) {
  return `
    <section class="panel table-wrap">
      <table class="data-table stacked-table">
        <thead>
          <tr>
            <th>Tarea</th>
            <th>Cliente</th>
            <th>Responsables</th>
            <th>Subtareas</th>
            <th>Estado</th>
            <th>Entrega</th>
            <th>Adjuntos</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          ${tasks.length ? tasks.map((task) => {
            const subtaskSummary = getSubtaskSummary(task);
            return `
            <tr>
              <td data-label="Tarea">
                <strong>${escapeHtml(task.title)}</strong>
                <div class="table-subtext">${escapeHtml(task.type)} · ${escapeHtml(task.channel)} · ${escapeHtml(task.priority)}</div>
              </td>
              <td data-label="Cliente">${escapeHtml(getClientName(task.clientId))}</td>
              <td data-label="Responsables">${escapeHtml(getTaskAssigneeNames(task))}</td>
              <td data-label="Subtareas">${subtaskSummary.total ? `${subtaskSummary.completed}/${subtaskSummary.total}` : '—'}</td>
              <td data-label="Estado"><select class="inline-status-select ${statusClass(task.status)}" data-task-status-select="${task.id}">${renderStatusOptions(task.status)}</select></td>
              <td data-label="Entrega">${escapeHtml(formatDate(getTaskDueReference(task) || task.dueDate))}</td>
              <td data-label="Adjuntos">${(task.attachments || []).length}</td>
              <td data-label="Acciones">
                <div class="table-actions">
                  <button class="text-button" data-edit-task="${task.id}">Editar</button>
                </div>
              </td>
            </tr>
          `}).join('') : `<tr><td colspan="8"><div class="empty-state">No hay tareas con esos filtros.</div></td></tr>`}
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
      <div class="calendar-scroll">
        <div class="calendar-grid">
          ${['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((day) => `<div class="small-text calendar-weekday">${day}</div>`).join('')}
          ${days.map((day) => `
            <div class="calendar-day ${day.isCurrentMonth ? '' : 'muted'}">
              <strong>${day.date.getDate()}</strong>
              ${day.items.slice(0, 3).map((task) => `<div class="calendar-item" data-edit-task="${task.id}">${escapeHtml(task.title)}</div>`).join('')}
            </div>
          `).join('')}
        </div>
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
  const teamCards = state.users.map((user) => {
    const metrics = getUserRemoteMetrics(user.id);
    const session = metrics.todaySession;
    const lastActivity = metrics.lastActivity;
    return `
      <article class="remote-user-card ${workStatusClass(session?.status || 'offline')}">
        <div class="client-card-header remote-user-head">
          <div>
            <h3 class="client-name">${escapeHtml(user.name)}</h3>
            <div class="small-text">${escapeHtml(user.role)}</div>
          </div>
          <span class="badge ${workStatusClass(session?.status || 'offline')}">${escapeHtml(workStatusLabel(session?.status || 'offline'))}</span>
        </div>
        <div class="remote-user-metrics">
          <div><strong>${session?.checkInAt ? formatDateTime(session.checkInAt) : '—'}</strong><span>Entrada</span></div>
          <div><strong>${session?.checkOutAt ? formatDateTime(session.checkOutAt) : '—'}</strong><span>Salida</span></div>
          <div><strong>${escapeHtml(getSessionWorkedLabel(session))}</strong><span>Tiempo</span></div>
          <div><strong>${metrics.openTasks}</strong><span>Tareas activas</span></div>
          <div><strong>${metrics.openSubtasks}</strong><span>Subtareas abiertas</span></div>
          <div><strong>${metrics.overdueTasks}</strong><span>Vencidas</span></div>
        </div>
        <div class="remote-copy-block">
          <strong>Plan de hoy</strong>
          <p class="small-text">${escapeHtml(session?.focusPlan || 'Sin plan registrado.')}</p>
        </div>
        <div class="remote-copy-block">
          <strong>Bloqueos</strong>
          <p class="small-text">${escapeHtml(session?.blockers || 'Sin bloqueos reportados.')}</p>
        </div>
        <div class="remote-copy-block">
          <strong>Última actividad</strong>
          <p class="small-text">${lastActivity ? `${escapeHtml(lastActivity.label)} · ${escapeHtml(formatDateTime(lastActivity.createdAt))}` : 'Sin actividad reciente.'}</p>
        </div>
      </article>
    `;
  }).join('');
  const teamCheckedIn = state.users.filter((user) => getTodaySession(user.id)?.checkInAt).length;
  const teamCheckedOut = state.users.filter((user) => getTodaySession(user.id)?.checkOutAt).length;
  const totalOverdue = state.users.reduce((acc, user) => acc + getUserRemoteMetrics(user.id).overdueTasks, 0);
  const recentActivity = (state.activityLogs || []).slice(0, 20);

  els.workspace.innerHTML = `
    <div class="admin-grid">
      <section class="panel table-wrap">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Usuarios</p>
            <h3 class="panel-title">Equipo y accesos</h3>
          </div>
        </div>
        <table class="data-table stacked-table">
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
                <td data-label="Nombre">
                  <strong>${escapeHtml(user.name)}</strong>
                  <div class="table-subtext">Último acceso ${escapeHtml(formatDateTime(user.lastLoginAt))}</div>
                </td>
                <td data-label="Rol">${escapeHtml(user.role)}</td>
                <td data-label="Estado"><span class="badge">${escapeHtml(user.status || 'active')}</span></td>
                <td data-label="Correo">${escapeHtml(user.email)}</td>
                <td data-label="Acciones">
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
      <section class="panel full-span">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Control remoto</p>
            <h3 class="panel-title">Monitoreo de equipo</h3>
          </div>
        </div>
        <div class="stats-grid compact-grid">
          <article class="stat-card"><p class="small-text">Con entrada hoy</p><div class="stat-value">${teamCheckedIn}</div></article>
          <article class="stat-card"><p class="small-text">Con salida registrada</p><div class="stat-value">${teamCheckedOut}</div></article>
          <article class="stat-card"><p class="small-text">Tareas vencidas</p><div class="stat-value">${totalOverdue}</div></article>
          <article class="stat-card"><p class="small-text">Actividad reciente</p><div class="stat-value">${recentActivity.length}</div></article>
        </div>
        <div class="remote-user-grid">${teamCards}</div>
      </section>
      <section class="panel">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Actividad</p>
            <h3 class="panel-title">Bitácora del equipo</h3>
          </div>
        </div>
        <div class="activity-feed">
          ${recentActivity.length ? recentActivity.map((item) => `
            <article class="activity-item">
              <div class="activity-top">
                <strong>${escapeHtml(getUserName(item.userId))}</strong>
                <span class="small-text">${escapeHtml(formatDateTime(item.createdAt))}</span>
              </div>
              <p>${escapeHtml(item.label)}</p>
              <div class="small-text">${escapeHtml(item.kind)}${item.entityType ? ` · ${escapeHtml(item.entityType)}` : ''}</div>
            </article>
          `).join('') : `<div class="empty-state">Todavía no hay actividad registrada.</div>`}
        </div>
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
  const session = getTodaySession(state.currentUser?.id);
  const myMetrics = getUserRemoteMetrics(state.currentUser?.id);
  const myActivity = getUserActivityLogs(state.currentUser?.id, 12);
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
      <section class="panel">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Jornada remota</p>
            <h3 class="panel-title">Mi control de trabajo</h3>
          </div>
          <div class="table-actions">
            <button class="ghost-button" type="button" id="checkInButton" ${session?.checkInAt ? 'disabled' : ''}>Marcar entrada</button>
            <button class="ghost-button" type="button" id="checkOutButton" ${session?.checkOutAt ? 'disabled' : ''}>Marcar salida</button>
          </div>
        </div>
        <div class="stats-grid compact-grid">
          <article class="stat-card"><p class="small-text">Entrada</p><div class="stat-value small-value">${escapeHtml(formatDateTime(session?.checkInAt))}</div></article>
          <article class="stat-card"><p class="small-text">Salida</p><div class="stat-value small-value">${escapeHtml(formatDateTime(session?.checkOutAt))}</div></article>
          <article class="stat-card"><p class="small-text">Tiempo</p><div class="stat-value small-value">${escapeHtml(getSessionWorkedLabel(session))}</div></article>
          <article class="stat-card"><p class="small-text">Estado</p><div class="stat-value small-value">${escapeHtml(workStatusLabel(session?.status || 'available'))}</div></article>
        </div>
        <form class="stack-form" id="workSessionForm">
          <label class="field">
            <span>Estado actual</span>
            <select id="workStatus">${renderWorkStatusOptions(session?.status || 'available')}</select>
          </label>
          <label class="field">
            <span>Plan del día</span>
            <textarea id="workFocusPlan" rows="3" placeholder="Ej: calendario de Eves Dental, captions y revisión de reels">${escapeHtml(session?.focusPlan || '')}</textarea>
          </label>
          <label class="field">
            <span>Bloqueos o necesidades</span>
            <textarea id="workBlockers" rows="2" placeholder="Ej: esperando aprobación, falta material, feedback pendiente">${escapeHtml(session?.blockers || '')}</textarea>
          </label>
          <label class="field">
            <span>Resumen de cierre</span>
            <textarea id="workEndSummary" rows="3" placeholder="Qué dejaste listo hoy y qué sigue mañana">${escapeHtml(session?.endSummary || '')}</textarea>
          </label>
          <button class="primary-button" type="submit">Guardar jornada</button>
        </form>
      </section>
      <section class="panel">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Mi medición</p>
            <h3 class="panel-title">Carga y entregas</h3>
          </div>
        </div>
        <div class="stats-grid compact-grid">
          <article class="stat-card"><p class="small-text">Tareas activas</p><div class="stat-value">${myMetrics.openTasks}</div></article>
          <article class="stat-card"><p class="small-text">Subtareas abiertas</p><div class="stat-value">${myMetrics.openSubtasks}</div></article>
          <article class="stat-card"><p class="small-text">Subtareas completadas</p><div class="stat-value">${myMetrics.completedSubtasks}</div></article>
          <article class="stat-card"><p class="small-text">Tareas vencidas</p><div class="stat-value">${myMetrics.overdueTasks}</div></article>
        </div>
        <div class="activity-feed compact-feed">
          ${myActivity.length ? myActivity.map((item) => `
            <article class="activity-item">
              <div class="activity-top">
                <strong>${escapeHtml(item.label)}</strong>
                <span class="small-text">${escapeHtml(formatDateTime(item.createdAt))}</span>
              </div>
              <div class="small-text">${escapeHtml(item.kind)}${item.entityType ? ` · ${escapeHtml(item.entityType)}` : ''}</div>
            </article>
          `).join('') : `<div class="empty-state">Aún no hay actividad registrada.</div>`}
        </div>
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
      showToast('Seguridad actualizada', 'Tu contraseña ya fue actualizada.');
      event.target.reset();
      await refreshBootstrap();
      state.tab = 'profile';
      render();
    } catch (error) {
      showToast('Error', error.message, 'error');
    }
  });

  document.getElementById('workSessionForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const result = await api('/api/work/session/today', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: document.getElementById('workStatus').value,
          focusPlan: document.getElementById('workFocusPlan').value.trim(),
          blockers: document.getElementById('workBlockers').value.trim(),
          endSummary: document.getElementById('workEndSummary').value.trim()
        })
      });
      const index = state.workSessions.findIndex((item) => item.id === result.session.id || (item.userId === result.session.userId && item.dateKey === result.session.dateKey));
      if (index >= 0) state.workSessions[index] = result.session; else state.workSessions.unshift(result.session);
      showToast('Jornada guardada', 'Se actualizó tu control remoto del día.');
      await refreshBootstrap();
      state.tab = 'profile';
      render();
    } catch (error) {
      showToast('Error', error.message, 'error');
    }
  });

  document.getElementById('checkInButton').addEventListener('click', async () => {
    try {
      const result = await api('/api/work/check-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: document.getElementById('workStatus').value,
          focusPlan: document.getElementById('workFocusPlan').value.trim(),
          blockers: document.getElementById('workBlockers').value.trim(),
          endSummary: document.getElementById('workEndSummary').value.trim()
        })
      });
      const index = state.workSessions.findIndex((item) => item.id === result.session.id || (item.userId === result.session.userId && item.dateKey === result.session.dateKey));
      if (index >= 0) state.workSessions[index] = result.session; else state.workSessions.unshift(result.session);
      showToast('Entrada registrada', 'Tu jornada remota ya inició.');
      await refreshBootstrap();
      state.tab = 'profile';
      render();
    } catch (error) {
      showToast('Error', error.message, 'error');
    }
  });

  document.getElementById('checkOutButton').addEventListener('click', async () => {
    try {
      const result = await api('/api/work/check-out', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          focusPlan: document.getElementById('workFocusPlan').value.trim(),
          blockers: document.getElementById('workBlockers').value.trim(),
          endSummary: document.getElementById('workEndSummary').value.trim()
        })
      });
      const index = state.workSessions.findIndex((item) => item.id === result.session.id || (item.userId === result.session.userId && item.dateKey === result.session.dateKey));
      if (index >= 0) state.workSessions[index] = result.session; else state.workSessions.unshift(result.session);
      showToast('Salida registrada', 'Tu jornada quedó cerrada.');
      await refreshBootstrap();
      state.tab = 'profile';
      render();
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
  document.getElementById('taskAssigneesBox').innerHTML = renderAssigneeCheckboxes(getTaskAssigneeIds(task || {}));
  document.getElementById('taskPriority').value = task?.priority || 'Media';
  document.getElementById('taskStatus').value = task?.status || 'not_started';
  document.getElementById('taskDueDate').value = task?.dueDate || '';
  document.getElementById('taskPublishDate').value = task?.publishDate || '';
  document.getElementById('taskApproval').checked = Boolean(task?.approvalRequired);
  document.getElementById('taskLabels').value = (task?.labels || []).join(', ');
  document.getElementById('taskChecklist').value = (task?.checklist || []).map((item) => item.text).join('\n');
  document.getElementById('taskComment').value = '';
  document.getElementById('taskFiles').value = '';
  renderTaskSubtasksEditor(task || null);
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
    assigneeIds: getSelectedTaskAssignees(),
    priority: document.getElementById('taskPriority').value,
    status: document.getElementById('taskStatus').value,
    dueDate: document.getElementById('taskDueDate').value,
    publishDate: document.getElementById('taskPublishDate').value,
    approvalRequired: document.getElementById('taskApproval').checked,
    labels: document.getElementById('taskLabels').value.split(',').map((item) => item.trim()).filter(Boolean),
    checklist: parseLinesToChecklist(document.getElementById('taskChecklist').value, original?.checklist || []),
    subtasks: collectSubtasksFromForm(original?.subtasks || []),
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
  document.querySelectorAll('[data-task-status-select]').forEach((select) => {
    select.addEventListener('change', async () => {
      const task = state.tasks.find((item) => item.id === select.dataset.taskStatusSelect);
      if (!task || task.status === select.value) return;
      try {
        const updated = await api(`/api/tasks/${task.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...task, status: select.value })
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
        const result = await api('/api/admin/run-reminders', { method: 'POST' });
        showToast('Recordatorios ejecutados', `Enviados: ${result.sent || 0} · Saltados: ${result.skipped || 0}`);
        await refreshBootstrap();
      } catch (error) {
        showToast('Error', error.message, 'error');
      }
    });
  }
  document.querySelectorAll('[data-delete-attachment]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await api(`/api/attachments/${button.dataset.deleteAttachment}`, { method: 'DELETE' });
        await refreshBootstrap();
        const taskId = document.getElementById('taskId').value;
        if (taskId) openTaskModal(taskId);
      } catch (error) {
        showToast('Error', error.message, 'error');
      }
    });
  });
}

async function refreshBootstrap() {
  const data = await api('/api/bootstrap');
  state.brand = data.brand;
  state.currentUser = data.currentUser;
  state.users = data.users;
  state.clients = data.clients;
  state.tasks = data.tasks;
  state.emailLogs = data.emailLogs || [];
  state.workSessions = data.workSessions || [];
  state.activityLogs = data.activityLogs || [];
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

function activateAuthView(view) {
  [...document.querySelectorAll('.auth-tab')].forEach((button) => {
    button.classList.toggle('active', button.dataset.authView === view);
  });
  els.loginView.classList.toggle('active', view === 'login');
  els.forgotView.classList.toggle('active', view === 'forgot');
  els.tokenView.classList.toggle('active', view === 'token');
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
    button.addEventListener('click', () => activateAuthView(button.dataset.authView));
  });

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
  });

  els.newTaskButton.addEventListener('click', () => openTaskModal());
  document.getElementById('addSubtaskButton').addEventListener('click', () => addSubtaskRow());
  els.newClientButton.addEventListener('click', () => openClientModal());
  els.newUserButton.addEventListener('click', () => openUserModal());
  els.logoutButton.addEventListener('click', async () => {
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
