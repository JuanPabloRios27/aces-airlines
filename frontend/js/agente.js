/*
 * agente.js · Panel de agentes / gerentes (base común)
 *   - pide la clave de agente (header x-agent-key en las APIs)
 *   - arma las pestañas; cada pestaña la pinta su archivo:
 *       agente-maletas.js  -> Persona A (Funcionalidad 2: confirmar maletas)
 *       agente-reservas.js -> Mari (crear y listar reservas)
 */
SkyUI.encabezado("agente");
const app = document.getElementById("app");
const CLAVE_AGENTE = "skycheck.agente";

const Agente = {
  clave: () => sessionStorage.getItem(CLAVE_AGENTE),
  salir() { sessionStorage.removeItem(CLAVE_AGENTE); location.reload(); },
  // Si el back dice 401, la clave ya no sirve
  manejarError(e) {
    if (e.status === 401) { SkyUI.toast("La clave de agente no es válida", "bad"); setTimeout(Agente.salir, 1200); return; }
    SkyUI.error(e);
  },
};

const pestanas = [
  { id: "maletas", titulo: "Maletas por confirmar", pintar: (el) => AgenteMaletas.pintar(el) },
  { id: "reservas", titulo: "Reservas", pintar: (el) => AgenteReservas.pintar(el) },
];

function login() {
  app.innerHTML = `
    <form class="card centrado" id="login">
      <h2>Acceso de agentes</h2>
      <p class="muted small">Solo para personal de ACES Airlines en el counter o la gerencia.</p>
      <div class="campo"><label for="clave">Clave de agente</label>
        <input id="clave" type="password" autocomplete="current-password" required></div>
      <button class="btn bloque" data-cargando="Verificando…">Entrar</button>
      ${SkyAPI.esDemo ? `<p class="alerta info small" style="margin:1rem 0 0"><span><b>Modo demo:</b> la clave es <span class="mono">aces-agente-2026</span></span></p>` : ""}
    </form>`;
  document.getElementById("login").onsubmit = async (e) => {
    e.preventDefault();
    const clave = document.getElementById("clave").value;
    try {
      // Probamos la clave con una consulta real
      await SkyUI.conCarga(e.target.querySelector("button"), () => SkyAPI.maletasPorEstado("pendiente", clave));
      sessionStorage.setItem(CLAVE_AGENTE, clave);
      panel();
    } catch (err) {
      SkyUI.toast(err.status === 401 ? "Clave incorrecta" : SkyUI.esc(err.message), "bad");
    }
  };
}

function panel(activa = "maletas") {
  app.innerHTML = `
    <div class="encabezado" style="display:flex;justify-content:space-between;align-items:end;gap:1rem;flex-wrap:wrap">
      <div><h1>Panel de agentes</h1><p class="muted" style="margin:0">Counter de check-in · ACES Airlines</p></div>
      <button class="btn chico borde" id="salir-agente">Cerrar sesión</button>
    </div>
    <div class="tabs" id="tabs">${pestanas.map((p) =>
      `<button data-tab="${p.id}" class="${p.id === activa ? "activo" : ""}">${p.titulo}</button>`).join("")}</div>
    <div id="contenido"></div>`;
  document.getElementById("salir-agente").onclick = Agente.salir;
  document.getElementById("tabs").onclick = (e) => {
    const b = e.target.closest("[data-tab]");
    if (b) panel(b.dataset.tab);
  };
  pestanas.find((p) => p.id === activa).pintar(document.getElementById("contenido"));
}

Agente.clave() ? panel() : login();
