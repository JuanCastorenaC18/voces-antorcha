const state = {
  user: null,
  competition: null,
  participants: [],
  judges: [],
  registrars: [],
  results: [],
  activeJudges: 0,
  scoreCount: 0,
  judgeCriteria: [],
  page: "Resumen",
  editingId: null,
  scoringId: null,
  search: "",
  categoryFilter: "all",
  formRevision: 0,
  source: null
};

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const initials = name => String(name || "A").split(/\s+/).slice(0, 2).map(part => part[0] || "").join("").toUpperCase();
const categoryById = id => state.competition?.categories?.find(category => category.id === id);
const categoryName = id => categoryById(id)?.name || id;

async function api(path, options = {}) {
  const {data:{session}}=await window.vocesAuth.auth.getSession();
  const response = await fetch(window.VOCES_API+path,{...options,headers:{'apikey':window.VOCES_KEY,...(session?{'Authorization':'Bearer '+session.access_token}:{}),...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})}});
  const contentType = response.headers.get("content-type") || "";
  if (!response.ok) {
    const data = contentType.includes("json") ? await response.json() : { error: "No se pudo completar la solicitud." };
    const error = new Error(data.error || "Ocurrió un error."); error.status = response.status; throw error;
  }
  if (contentType.includes("json")) return response.json();
  return response;
}

function showToast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.add("show");
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => node.classList.remove("show"), 2600);
}

function showGate(mode,message=''){
 state.source?.close();state.user=null;
 $('#gate').classList.remove('hidden');$('#workspace').classList.add('hidden');
 $('#gate-title').textContent=mode==='setup'?'Activa tu concurso':'Acceso al concurso';
 $('#gate-copy').textContent=mode==='setup'?'Crea tu cuenta de administrador con el código privado de activación.':'Entra con el correo y la contraseña que te asignó la administración.';
 $('#gate-form').innerHTML=`${mode==='setup'?'<div class="field"><label for="setup-code">Código de activación</label><input id="setup-code" name="code" required autocomplete="off"></div><div class="field"><label for="login-name">Tu nombre</label><input id="login-name" name="name" required autocomplete="name"></div>':''}<div class="field"><label for="login-email">Correo</label><input id="login-email" name="email" type="email" required autocomplete="username"></div><div class="field"><label for="login-password">Contraseña</label><input id="login-password" name="password" type="password" required ${mode==='setup'?'minlength="12"':''} autocomplete="${mode==='setup'?'new-password':'current-password'}"></div><p class="form-error" role="alert">${esc(message)}</p><button class="btn btn-primary btn-block" type="submit">${mode==='setup'?'Crear administrador':'Entrar al concurso →'}</button>`;
 $('#gate-form').onsubmit=async e=>{e.preventDefault();const form=e.currentTarget,b=Object.fromEntries(new FormData(form)),button=form.querySelector('button');button.disabled=true;
 try{if(mode==='setup')await api('/api/setup',{method:'POST',body:JSON.stringify(b)});
 const {error}=await window.vocesAuth.auth.signInWithPassword({email:b.email,password:b.password});if(error)throw new Error('Correo o contraseña incorrectos, o acceso temporalmente limitado.');
 await openWorkspace();}catch(error){form.querySelector('.form-error').textContent=error.message;}finally{button.disabled=false;}};
}
async function boot(){
 try{const status=await api('/api/setup/status');state.competition=status.competition;
 if(!status.complete)return showGate('setup');
 const {data:{session}}=await window.vocesAuth.auth.getSession();if(!session)return showGate('login');await openWorkspace();
 }catch(error){showGate('login',error.message);}
}

async function openWorkspace() {
  const me = await api("/api/me");
  state.user = me.user;
  state.competition = me.competition;
  $("#gate").classList.add("hidden");
  $("#workspace").classList.remove("hidden");
  $("#user-name").textContent = state.user.name;
  $("#user-role").textContent = state.user.role === "admin" ? "Administración" : state.user.role === "registration" ? "Registro de concursantes" : "Jurado calificador";
  $("#user-avatar").textContent = initials(state.user.name);
  $("#top-avatar").textContent = initials(state.user.name);
  const navItems = state.user.role === "admin"
    ? [["Resumen", "◫"], ["Concursantes", "♬"], ["Jueces", "♙"], ["Personal de registro", "♧"], ["Resultados", "▤"]]
    : state.user.role === "registration" ? [["Concursantes", "♬"]] : [["Calificar", "✦"]];
  if (!navItems.some(([label]) => label === state.page)) state.page = navItems[0][0];
  state.editingId = null;
  state.scoringId = null;
  state.search = "";
  $("#navigation").innerHTML = navItems.map(([label, icon]) => `<button type="button" class="nav-button ${state.page === label || (state.user.role === "judge" && label === "Calificar") ? "active" : ""}" data-page="${esc(label)}"><span class="nav-icon">${icon}</span>${esc(label)}</button>`).join("");
  $("#navigation").onclick = event => {
    const button = event.target.closest("[data-page]");
    if (!button) return;
    state.page = button.dataset.page;
    state.editingId = null;
    state.scoringId = null;
    render();
  };
  $("#logout-button").onclick = async () => {state.source?.close();await window.vocesAuth.auth.signOut({scope:"local"});state.user=null;showGate("login");};
  await refresh();
  connectLive();
  render();
}

async function refresh(preserveDraft = false) {
  const revision = state.formRevision;
  const draftPage = state.page;
  const drafts = preserveDraft ? [...document.querySelectorAll("#page-content form")].map(form => ({ id: form.id, values: Object.fromEntries(new FormData(form)) })) : [];
  const focusedId = preserveDraft ? document.activeElement?.id : null;
  if (!state.user) return;
  const me = await api("/api/me");
  state.competition = me.competition;
  if (state.user.role === "admin") {
    const [roster, panel, results, registration] = await Promise.all([api("/api/participants"), api("/api/judges"), api("/api/results"), api("/api/registrars")]);
    state.registrars = registration.registrars;
    state.participants = roster.participants;
    state.judges = panel.judges;
    state.results = results.participants;
    state.activeJudges = results.activeJudges;
    state.scoreCount = results.scoreCount;
  } else if (state.user.role === "registration") {
    const data = await api("/api/participants");
    state.participants = data.participants;
    state.judges = []; state.registrars = []; state.results = [];
  } else {
    const data = await api("/api/judge/participants");
    state.participants = data.participants;
    state.judgeCriteria = data.criteria;
  }
  render();
  for (const draft of revision === state.formRevision && draftPage === state.page ? drafts : []) {
    const form = document.getElementById(draft.id);
    if (!form) continue;
    for (const [name, value] of Object.entries(draft.values)) {
      const field = form.elements.namedItem(name);
      if (field) field.value = value;
    }
    if (draft.id === "participant-form") $("#p-category").dispatchEvent(new Event("change"));
  }
  if (focusedId) document.getElementById(focusedId)?.focus();
}

function connectLive() {
  state.source?.close(); let busy=false;
  const timer=setInterval(async()=>{if(busy || document.hidden)return;busy=true;try{await refresh(true);$("#connection-label").textContent="Actualizado";$("#connection-dot").classList.remove("offline");}catch(error){$("#connection-label").textContent="Sin conexión";$("#connection-dot").classList.add("offline");if(error.status===401 || error.status===403){clearInterval(timer);state.user=null;showGate("login",error.message);}}finally{busy=false}},15000);
  state.source={close:()=>clearInterval(timer)};
  $("#connection-label").textContent="Actualizado";
}

function render() {
  if (!state.user) return;
  const titles = { "Resumen": "Resumen", "Concursantes": "Concursantes", "Jueces": "Jueces", "Resultados": "Resultados", "Calificar": "Calificación" };
  $("#page-title").textContent = state.user.role === "judge" && state.scoringId ? "Calificar concursante" : (titles[state.page] || state.page);
  $("#page-kicker").textContent = state.user.role === "judge" ? "JURADO CALIFICADOR" : "PANEL DE CONTROL";
  const content = $("#page-content");
  content.className = "page-content reveal";
  if (state.user.role === "judge") content.innerHTML = renderJudge();
  else if (state.user.role === "registration" || state.page === "Concursantes") content.innerHTML = renderContestants();
  else if (state.page === "Jueces") content.innerHTML = renderJudges();
  else if (state.page === "Personal de registro") content.innerHTML = renderRegistrars();
  else if (state.page === "Resultados") content.innerHTML = renderResults();
  else content.innerHTML = renderSummary();
  bindPageEvents();
}

function renderSummary() {
  const count = state.participants.length;
  const completeCount = state.results.filter(item => item.complete).length;
  const judgedCount = state.results.filter(item => item.judgeCount > 0).length;
  const cards = [
    ["Concursantes", count, "Inscritos en todas las categorías"],
    ["Jueces activos", state.activeJudges, "Cuentas habilitadas"],
    ["Calificaciones", state.scoreCount, "Puntuaciones guardadas"],
    ["En evaluación", `${judgedCount}/${count}`, `${completeCount} con todas las calificaciones`]
  ];
  const categories = state.competition.categories.map(category => {
    const total = state.participants.filter(item => item.categoryId === category.id).length;
    return `<div class="category-row"><span class="category-order">${category.order}</span><div class="category-name">${esc(category.name)}<span class="category-rule">${esc(category.rule)}</span></div><span class="category-count">${total}</span></div>`;
  }).join("");
  return `<section class="hero-card"><div><div class="eyebrow">SÁBADO · 24 DE OCTUBRE DE 2026</div><h2>${esc(state.competition.name)}</h2><p>Concurso de solistas · Acompañamiento únicamente con pista</p></div><div class="hero-tag">${esc(state.competition.startTime)} H · ${esc(state.competition.location)}</div></section>
    <section class="stats-grid">${cards.map(([label, value, sub]) => `<article class="stat-card"><div class="stat-label">${esc(label)}</div><div class="stat-value">${esc(value)}</div><div class="stat-sub">${esc(sub)}</div></article>`).join("")}</section>
    <section class="content-grid"><article class="panel"><div class="panel-head"><div><h3>Orden oficial de categorías</h3><p>Según la convocatoria de la jornada</p></div><span class="pill pill-soft">${count} inscritos</span></div>${categories}</article><article class="panel"><div class="panel-head"><div><h3>Criterios de evaluación</h3><p>Escala aplicada en esta versión: 0 a 10</p></div></div><div class="criteria-list">${state.competition.criteria.map(item => `<div class="criterion-line"><span>${esc(item)}</span><span class="criterion-check">●</span></div>`).join("")}</div><div class="notice-inline" style="margin:17px 0 0">El promedio se marca como completo cuando todos los jueces activos califican al concursante.</div></article></section>`;
}

function registrationForm(item = null) {
  const p = item || {};
  const selected = p.categoryId || "";
  const categoryOptions = state.competition.categories.map(category => `<option value="${esc(category.id)}" ${selected === category.id ? "selected" : ""}>${esc(category.name)}</option>`).join("");
  const requiresSupport = selected === "libre_obrero" || selected === "semiprofesional";
  return `<div class="panel form-panel"><div class="panel-head"><div><h3>${item ? "Editar concursante" : "Nuevo registro"}</h3><p>Datos requeridos por la convocatoria</p></div>${item ? `<span class="pill pill-green">${esc(item.folio)}</span>` : ""}</div>
    <form id="participant-form" class="form-grid">
      <div class="field wide"><label for="p-name">Nombre completo</label><input id="p-name" name="name" required value="${esc(p.name || "")}" placeholder="Nombre y apellidos"></div>
      <div class="field"><label for="p-age">Edad</label><input id="p-age" name="age" type="number" min="3" max="110" required value="${esc(p.age ?? "")}" placeholder="Años"></div>
      <div class="field"><label for="p-category">Categoría</label><select id="p-category" name="categoryId" required><option value="">Selecciona</option>${categoryOptions}</select></div>
      <div class="field wide"><label for="p-section">Seccional</label><input id="p-section" name="seccional" required value="${esc(p.seccional || "")}" placeholder="Seccional o comisión"></div>
      <div class="field wide"><label for="p-curp">CURP</label><input id="p-curp" name="curp" required maxlength="18" minlength="18" value="${esc(p.curp || "")}" placeholder="18 caracteres" autocapitalize="characters"></div>
      <div class="field wide"><label for="p-song">Título de la canción</label><input id="p-song" name="songTitle" required value="${esc(p.songTitle || "")}" placeholder="Canción a interpretar"></div>
      <div class="field"><label for="p-lyrics">Autor de la letra</label><input id="p-lyrics" name="lyricAuthor" required value="${esc(p.lyricAuthor || "")}" placeholder="Nombre del autor"></div>
      <div class="field"><label for="p-music">Autor de la música</label><input id="p-music" name="musicAuthor" required value="${esc(p.musicAuthor || "")}" placeholder="Nombre del autor"></div>
      <div class="field wide ${requiresSupport ? "" : "hidden"}" id="eligibility-wrap"><label for="p-eligibility">Condición o respaldo de categoría</label><input id="p-eligibility" name="eligibility" ${requiresSupport ? "required" : ""} value="${esc(p.eligibility || "")}" placeholder="Colono / obrero / campesino o respaldo de Semiprofesional"><small id="eligibility-hint">${selected === "semiprofesional" ? "Indica ganador nacional, estudiante o maestro de música." : "Requerido para Libre campesino, obrero y popular."}</small></div>
      <div id="p-error" class="form-error wide"></div>
      <div class="form-actions wide"><button class="btn btn-primary" type="submit">${item ? "Guardar cambios" : "Registrar concursante"}</button>${item ? `<button class="btn btn-quiet" type="button" data-action="cancel-edit">Cancelar</button>` : ""}</div>
    </form></div>`;
}

function renderContestants() {
  const admin = state.user.role === "admin";
  const rows = state.participants.filter(item => {
    const haystack = `${item.name} ${item.folio} ${item.curp || ""} ${item.seccional} ${item.songTitle}`.toLocaleLowerCase();
    return haystack.includes(state.search.toLocaleLowerCase());
  });
  const table = rows.length ? `<div class="table-wrap"><table><thead><tr><th>Folio / participante</th><th>Categoría</th><th>Seccional</th><th>Canción</th><th>Orden</th><th></th></tr></thead><tbody>${rows.map(item => `<tr><td><span class="primary-cell">${esc(item.name)}</span><span class="secondary-cell">${esc(item.folio)} · ${esc(item.age)} años</span></td><td>${esc(categoryName(item.categoryId))}</td><td>${esc(item.seccional)}</td><td><span class="primary-cell">${esc(item.songTitle)}</span><span class="secondary-cell">${esc(item.lyricAuthor)} / ${esc(item.musicAuthor)}</span></td><td>${item.drawOrder ? `<span class="rank">${item.drawOrder}</span>` : `<span class="secondary-cell">Pendiente</span>`}</td><td>${admin ? `<div class="action-cell"><button type="button" class="btn btn-quiet btn-small" data-action="edit" data-id="${esc(item.id)}">Editar</button><button type="button" class="btn btn-danger btn-small" data-action="delete" data-id="${esc(item.id)}">Quitar</button></div>` : ""}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty-state"><strong>${state.participants.length ? "No hay coincidencias" : "Aún no hay concursantes"}</strong>${state.participants.length ? "Prueba con otro nombre, folio o seccional." : "Completa el formulario para crear el primer registro."}</div>`;
  return `<div class="section-intro"><div><h2>Registro de participantes</h2><p>Se valida una inscripción por categoría y seccional, de acuerdo con la convocatoria.</p></div><div class="action-strip">${admin ? `<button class="btn btn-outline" type="button" data-action="raffle">Sortear orden</button>` : ""}<span class="pill pill-soft">${state.participants.length} inscritos</span></div></div>
    <div class="notice-inline deadline-note">La convocatoria marcó el 14 de octubre de 2026 como fecha límite de inscripción. La app permite registrar datos para la operación local; confirma cualquier alta posterior con la Comisión Estatal.</div>
    <div class="admin-layout">${registrationForm(admin && state.editingId ? state.participants.find(item => item.id === state.editingId) : null)}<div class="panel table-panel"><div class="panel-head"><div><h3>Lista de concursantes</h3><p>El CURP solo aparece en este formulario; no se muestra en la lista.</p></div><div class="table-tools"><input class="search-input" id="participant-search" value="${esc(state.search)}" placeholder="Buscar participante"></div></div>${table}</div></div>`;
}

function renderJudges() {
  const active = state.judges.filter(judge => judge.active !== false).length;
  const roster = state.judges.length ? `<div class="judge-list">${state.judges.map(judge => `<div class="judge-row"><span class="judge-initial">${esc(initials(judge.name))}</span><span class="judge-info"><strong>${esc(judge.name)}</strong><small>@${esc(judge.username)} · ${judge.active === false ? "Deshabilitado" : "Activo"}</small></span><span class="pill ${judge.active === false ? "pill-soft" : "pill-green"}">${judge.active === false ? "PAUSADO" : "ACTIVO"}</span><button class="btn btn-small ${judge.active === false ? "btn-outline" : "btn-danger"}" type="button" data-action="toggle-judge" data-id="${esc(judge.id)}" data-active="${judge.active === false ? "true" : "false"}">${judge.active === false ? "Habilitar" : "Deshabilitar"}</button></div>`).join("")}</div>` : `<div class="empty-state"><strong>Aún no agregas jueces</strong>Crea una cuenta para cada integrante del jurado.</div>`;
  return `<div class="section-intro"><div><h2>Jueces calificadores</h2><p>Cada juez tiene su propio acceso y solo puede ver sus puntuaciones.</p></div><span class="pill pill-green">${active} activos</span></div><div class="judge-layout"><div class="panel"><div class="panel-head"><div><h3>Agregar juez</h3><p>Asigna el correo y una contraseña de al menos 12 caracteres.</p></div></div><form id="judge-form" class="form-stack"><div class="field"><label for="j-name">Nombre completo</label><input id="j-name" name="name" required placeholder="Nombre del juez"></div><div class="field"><label for="j-user">Correo de acceso</label><input id="j-user" name="email" type="email" required placeholder="juez@ejemplo.com"></div><div class="field"><label for="j-password">Contraseña</label><input id="j-password" name="password" type="password" minlength="12" maxlength="128" autocomplete="new-password" required></div><div id="j-error" class="form-error"></div><button class="btn btn-primary" type="submit">Registrar juez</button></form></div><div class="panel"><div class="panel-head"><div><h3>Equipo de evaluación</h3><p>Jueces activos cuentan para cerrar los promedios.</p></div><span class="pill pill-soft">${state.judges.length} cuentas</span></div>${roster}</div></div>`;
}

function renderRegistrars() {
  const active = state.registrars.filter(judge => judge.active !== false).length;
  const roster = state.registrars.length ? `<div class="judge-list">${state.registrars.map(judge => `<div class="judge-row"><span class="judge-initial">${esc(initials(judge.name))}</span><span class="judge-info"><strong>${esc(judge.name)}</strong><small>@${esc(judge.username)} · ${judge.active === false ? "Deshabilitado" : "Activo"}</small></span><span class="pill ${judge.active === false ? "pill-soft" : "pill-green"}">${judge.active === false ? "PAUSADO" : "ACTIVO"}</span><button class="btn btn-small ${judge.active === false ? "btn-outline" : "btn-danger"}" type="button" data-action="toggle-registrar" data-id="${esc(judge.id)}" data-active="${judge.active === false ? "true" : "false"}">${judge.active === false ? "Habilitar" : "Deshabilitar"}</button></div>`).join("")}</div>` : `<div class="empty-state"><strong>Aún no agregas personal de registro</strong>Crea una cuenta para cada persona encargada de registrar concursantes.</div>`;
  return `<div class="section-intro"><div><h2>Personal de registro</h2><p>Cuentas con acceso exclusivo al registro y consulta de concursantes.</p></div><span class="pill pill-green">${active} activos</span></div><div class="judge-layout"><div class="panel"><div class="panel-head"><div><h3>Agregar personal de registro</h3><p>Asigna el correo y una contraseña de al menos 12 caracteres.</p></div></div><form id="registrar-form" class="form-stack"><div class="field"><label for="r-name">Nombre completo</label><input id="r-name" name="name" required placeholder="Nombre de la persona"></div><div class="field"><label for="r-user">Correo de acceso</label><input id="r-user" name="email" type="email" required placeholder="registro@ejemplo.com"></div><div class="field"><label for="r-password">Contraseña</label><input id="r-password" name="password" type="password" minlength="12" maxlength="128" autocomplete="new-password" required></div><div id="r-error" class="form-error"></div><button class="btn btn-primary" type="submit">Crear cuenta de Registro</button></form></div><div class="panel"><div class="panel-head"><div><h3>Equipo de registro</h3><p>Puedes habilitar o deshabilitar el acceso de cada persona.</p></div><span class="pill pill-soft">${state.registrars.length} cuentas</span></div>${roster}</div></div>`;
}

function renderResults() {
  const byCategory = state.competition.categories.map(category => {
    const entries = state.results.filter(item => item.categoryId === category.id);
    if (!entries.length) return "";
    return `<section class="category-block"><h3>${category.order}. ${esc(category.name)}</h3><div class="table-wrap"><table><thead><tr><th>Lugar</th><th>Concursante</th><th>Canción</th><th>Promedio</th><th>Jueces</th><th>Estado</th></tr></thead><tbody>${entries.map(item => `<tr><td>${item.place ? `<span class="rank ${item.place === 1 ? "gold" : item.place === 2 ? "silver" : item.place === 3 ? "bronze" : ""}">${item.place}</span>` : "—"}</td><td><span class="primary-cell">${esc(item.name)}</span><span class="secondary-cell">${esc(item.folio)} · ${esc(item.age)} años · ${esc(item.seccional)}</span></td><td>${esc(item.songTitle)}</td><td><strong>${item.average === null ? "—" : item.average.toFixed(2)}</strong><span class="secondary-cell">de 10 puntos</span>${item.judgeCount ? `<details class="breakdown"><summary>Ver desglose</summary><div class="breakdown-inner"><div class="breakdown-title">Promedio por criterio</div>${state.competition.criteria.map(criterion => `<div class="breakdown-row"><span>${esc(criterion)}</span><strong>${item.perCriterion[criterion].toFixed(2)}</strong></div>`).join("")}<div class="breakdown-title judge-breakdown-title">Calificación por juez</div>${item.judgeDetails.map(detail => `<div class="judge-breakdown"><strong>${esc(detail.judgeName)}</strong><span>${state.competition.criteria.map(criterion => `${esc(criterion)}: ${Number(detail.scores[criterion]).toFixed(1)}`).join(" · ")}</span></div>`).join("")}</div></details>` : ""}</td><td>${item.judgeCount}/${item.activeJudges}</td><td><span class="pill ${item.complete ? "pill-green" : "pill-orange"}">${item.complete ? "COMPLETO" : item.judgeCount ? "PARCIAL" : "SIN CALIFICAR"}</span></td></tr>`).join("")}</tbody></table></div></section>`;
  }).join("");
  return `<div class="section-intro"><div><h2>Resultados por categoría</h2><p>Promedios en vivo; las posiciones se calculan con las calificaciones recibidas.</p></div><div class="action-strip"><button class="btn btn-primary" id="export-results" type="button">Descargar CSV</button></div></div><div class="notice-inline">La convocatoria no fija escala numérica. La app promedia cinco criterios de 0 a 10 y después promedia las evaluaciones de los jueces. Las posiciones pueden cambiar hasta que todos los jueces activos califiquen.</div>${byCategory || `<div class="panel empty-state"><strong>Sin concursantes registrados</strong>Los resultados aparecerán cuando se creen registros.</div>`}`;
}

function renderJudge() {
  const selected = state.participants.find(item => item.id === state.scoringId);
  if (selected) {
    const previous = selected.myScore;
    const criteria = state.judgeCriteria.length ? state.judgeCriteria : state.competition.criteria;
    return `<section class="panel score-form"><div class="score-intro"><div><div class="eyebrow">${esc(categoryName(selected.categoryId))} · ${esc(selected.folio)}</div><h2>${esc(selected.name)}</h2><p>${esc(selected.songTitle)}${selected.drawOrder ? ` · Orden ${selected.drawOrder}` : ""}</p></div><button class="btn btn-outline btn-small" data-action="back-score" type="button">Volver a la lista</button></div><div class="notice-inline">Asigna una puntuación individual a cada criterio. La convocatoria solicita modalidad solista y acompañamiento únicamente con pista.</div><form id="score-form" data-id="${esc(selected.id)}"><div class="score-grid">${criteria.map((criterion, index) => `<div class="score-criterion"><label for="score-${index}"><span>${esc(criterion)}</span><span class="eyebrow">0–10</span></label><input id="score-${index}" name="criterion-${index}" type="number" min="0" max="10" step="0.5" required value="${previous ? esc(previous.scores[criterion]) : ""}" placeholder="Ej. 8.5"></div>`).join("")}</div><div class="field score-comment"><label for="score-comment">Observaciones (opcional)</label><textarea id="score-comment" name="comment" maxlength="500" placeholder="Anota una observación para tu referencia">${esc(previous?.comment || "")}</textarea></div><div id="score-error" class="form-error"></div><div class="score-footer"><span class="score-scale">${previous ? `Último guardado: ${new Date(previous.updatedAt).toLocaleString("es-MX")}` : "Aún no has guardado una puntuación."}</span><button type="submit" class="btn btn-primary">Guardar calificación</button></div></form></section>`;
  }
  const query = state.search.toLocaleLowerCase();
  const visible = state.participants.filter(item => `${item.name} ${item.folio} ${item.songTitle}`.toLocaleLowerCase().includes(query));
  const groups = state.competition.categories.map(category => {
    const items = visible.filter(item => item.categoryId === category.id);
    if (!items.length) return "";
    return `<section class="category-block"><h3>${category.order}. ${esc(category.name)}</h3><div class="judge-card-list">${items.map(item => {
      const current = item.myScore;
      const scoreAvg = current ? Object.values(current.scores).reduce((a, n) => a + Number(n), 0) / Math.max(1, state.judgeCriteria.length) : null;
      return `<article class="contestant-card"><div class="contestant-top"><span class="folio">${esc(item.folio)}${item.drawOrder ? ` · ORDEN ${item.drawOrder}` : ""}</span><span class="pill ${current ? "pill-green" : "pill-soft"}">${current ? "GUARDADO" : "PENDIENTE"}</span></div><h3>${esc(item.name)}</h3><p>${esc(item.songTitle)}</p><div class="score-preview">${current ? `Tu promedio: <strong>${scoreAvg.toFixed(2)} / 10</strong>` : "Cinco criterios · escala 0 a 10"}</div><button class="btn ${current ? "btn-outline" : "btn-dark"} btn-small" type="button" data-action="open-score" data-id="${esc(item.id)}">${current ? "Revisar puntuación" : "Calificar concursante"} →</button></article>`;
    }).join("")}</div></section>`;
  }).join("");
  return `<div class="judge-headline"><div><h2>Tu lista de evaluación</h2><p>Las puntuaciones que guardes se transmiten al panel en vivo.</p></div><input class="search-input" id="judge-search" value="${esc(state.search)}" placeholder="Buscar"></div>${groups || `<div class="panel empty-state"><strong>${state.participants.length ? "No hay coincidencias" : "Aún no hay concursantes"}</strong>${state.participants.length ? "Prueba con otro nombre o canción." : "Pide a la administración que registre participantes."}</div>`}`;
}

function bindPageEvents() {
  const participantForm = $("#participant-form");
  if (participantForm) {
    const categorySelect = $("#p-category");
    categorySelect.onchange = () => {
      const category = categorySelect.value;
      const required = category === "libre_obrero" || category === "semiprofesional";
      $("#eligibility-wrap").classList.toggle("hidden", !required);
      $("#p-eligibility").required = required;
      $("#eligibility-hint").textContent = category === "semiprofesional" ? "Indica ganador nacional, estudiante o maestro de música." : "Requerido para Libre campesino, obrero y popular.";
    };
    participantForm.onsubmit = async event => {
      event.preventDefault();
      const formElement = event.currentTarget;
      const submit = formElement.querySelector("button[type=submit]");
      submit.disabled = true;
      const formData = Object.fromEntries(new FormData(formElement));
      formData.age = Number(formData.age);
      try {
        if (state.editingId) await api(`/api/participants/${state.editingId}`, { method: "PATCH", body: JSON.stringify(formData) });
        else await api("/api/participants", { method: "POST", body: JSON.stringify(formData) });
        state.editingId = null;
        state.formRevision += 1;
        showToast("Registro guardado correctamente.");
        await refresh();
      } catch (error) {
        formElement.querySelector("#p-error").textContent = error.message;
        submit.disabled = false;
      }
    };
  }
  const judgeForm = $("#judge-form");
  if (judgeForm) judgeForm.onsubmit = async event => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const submit = formElement.querySelector("button[type=submit]");
    submit.disabled = true;
    try {
      await api("/api/judges", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(formElement))) });
      state.formRevision += 1;
      showToast("Juez registrado. Puede ingresar con su correo autorizado.");
      await refresh();
    } catch (error) {
      formElement.querySelector("#j-error").textContent = error.message;
      submit.disabled = false;
    }
  };
  const registrarForm = $("#registrar-form");
  if (registrarForm) registrarForm.onsubmit = async event => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const submit = formElement.querySelector("button[type=submit]");
    submit.disabled = true;
    try {
      await api("/api/registrars", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(formElement))) });
      state.formRevision += 1;
      showToast("Cuenta de Registro creada. Puede ingresar con su correo autorizado.");
      await refresh();
    } catch (error) {
      formElement.querySelector("#r-error").textContent = error.message;
      submit.disabled = false;
    }
  };
  const scoreForm = $("#score-form");
  if (scoreForm) scoreForm.onsubmit = async event => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const submit = formElement.querySelector("button[type=submit]");
    submit.disabled = true;
    const formData = new FormData(formElement);
    const scores = {};
    state.judgeCriteria.forEach((criterion, index) => { scores[criterion] = Number(formData.get(`criterion-${index}`)); });
    try {
      await api(`/api/scores/${state.scoringId}`, { method: "POST", body: JSON.stringify({ scores, comment: formData.get("comment") }) });
      showToast("Calificación guardada y sincronizada.");
      await refresh();
    } catch (error) {
      formElement.querySelector("#score-error").textContent = error.message;
      submit.disabled = false;
    }
  };
  const search = $("#participant-search");
  if (search) search.oninput = event => { state.search = event.target.value; const cursor = event.target.selectionStart; render(); const next = $("#participant-search"); next.focus(); next.setSelectionRange(cursor, cursor); };
  const judgeSearch = $("#judge-search");
  if (judgeSearch) judgeSearch.oninput = event => { state.search = event.target.value; const cursor = event.target.selectionStart; render(); const next = $("#judge-search"); next.focus(); next.setSelectionRange(cursor, cursor); };
  $("#page-content").onclick = async event => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const id = button.dataset.id;
    const action = button.dataset.action;
    try {
      if (action === "edit") { state.editingId = id; render(); window.scrollTo({ top: 0, behavior: "smooth" }); }
      if (action === "cancel-edit") { state.editingId = null; render(); }
      if (action === "delete") {
        if (!window.confirm("¿Quitar este concursante y sus calificaciones del registro?")) return;
        await api(`/api/participants/${id}`, { method: "DELETE" });
        showToast("Concursante eliminado."); await refresh();
      }
      if (action === "raffle") {
        if (!state.participants.length) { showToast("Registra concursantes antes de sortear."); return; }
        if (!window.confirm("Se asignará un orden aleatorio a cada categoría. ¿Continuar?")) return;
        await api("/api/raffle", { method: "POST", body: "{}" });
        showToast("Orden sorteado dentro de cada categoría."); await refresh();
      }
      if (action === "toggle-registrar") {
        await api(`/api/registrars/${id}`, { method: "PATCH", body: JSON.stringify({ active: button.dataset.active === "true" }) });
        showToast("Estado de la cuenta actualizado."); await refresh();
      }
      if (action === "toggle-judge") {
        await api(`/api/judges/${id}`, { method: "PATCH", body: JSON.stringify({ active: button.dataset.active === "true" }) });
        showToast("Estado del juez actualizado."); await refresh();
      }
      if (action === "open-score") { state.scoringId = id; render(); window.scrollTo({ top: 0, behavior: "smooth" }); }
      if (action === "back-score") { state.scoringId = null; render(); }
    } catch (error) { showToast(error.message); }
  };
}

boot().catch(error => showGate("login", error.message));

document.addEventListener('click',async event=>{if(!event.target.closest('#export-results'))return;const button=event.target.closest('#export-results');button.disabled=true;try{const response=await api('/api/export.csv');const url=URL.createObjectURL(await response.blob());const a=document.createElement('a');a.href=url;a.download='resultados-voces.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){showToast(e.message)}finally{button.disabled=false}});
