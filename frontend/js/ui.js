/*
 * ui.js · Utilidades de interfaz compartidas (base común)
 *   - encabezado y pie de página
 *   - sesión del pasajero (código de reserva + correo)
 *   - toasts, formatos, chips de estado, botón con "cargando"
 *   - componente del pase de abordar (lo usan reserva.html y checkin.html)
 */
(function () {
  const ICONOS = {
    avion: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg>',
    maleta: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="7" width="14" height="13" rx="2"/><path d="M9 7V4h6v3M9 11v5M15 11v5"/></svg>',
    mochila: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 9a5 5 0 0 1 10 0v10a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2z"/><path d="M10 4h4M9 14h6"/></svg>',
    check: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    editar: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
    escudo: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>',
    pase: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4z"/><path d="M14 5v14" stroke-dasharray="2 2"/></svg>',
    x: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    flecha: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>',
  };

  const CIUDADES = {
    BOG: "Bogotá", MDE: "Medellín", CLO: "Cali", CTG: "Cartagena", BAQ: "Barranquilla",
    SMR: "Santa Marta", BGA: "Bucaramanga", PEI: "Pereira", ADZ: "San Andrés", CUC: "Cúcuta",
    MIA: "Miami", MAD: "Madrid", PTY: "Panamá", LIM: "Lima", MEX: "Ciudad de México",
  };

  const ESTADOS = {
    reservado: ["Reservado", "info"],
    checkin: ["Check-in listo", "ok"],
    cancelado: ["Cancelado", "bad"],
    pendiente: ["Pendiente", "warn"],
    confirmada: ["Confirmada", "ok"],
    cancelada: ["Cancelada", "bad"],
  };

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ------------------------------------------------------------ encabezado
  function encabezado(activo) {
    const demo = window.SkyAPI && SkyAPI.esDemo;
    const links = [
      ["index.html", "inicio", "Inicio"],
      ["reserva.html", "reserva", "Mi reserva"],
      ["agente.html", "agente", "Agentes"],
    ];
    const header = document.createElement("header");
    header.innerHTML = `
      <div class="topbar">
        <div class="contenedor">
          <a class="logo" href="index.html">${ICONOS.avion}<b>SkyCheck</b><span>ACES Airlines</span></a>
          ${demo ? '<span class="badge-demo" title="Datos de prueba guardados en tu navegador">DEMO</span>' : ""}
          <nav class="nav">${links.map(([href, id, txt]) =>
            `<a href="${href}" class="${id === activo ? "activo" : ""}">${txt}</a>`).join("")}</nav>
        </div>
      </div>
      <div class="topbar-linea"></div>`;
    document.body.prepend(header);

    const pie = document.createElement("footer");
    pie.className = "pie";
    pie.innerHTML = `SkyCheck · ACES Projects · Nube y Arquitectura Serverless · Universidad El Bosque
      ${demo ? '<br><a href="#" id="reiniciar-demo">Reiniciar datos de demo</a>' : ""}`;
    document.body.append(pie);
    const r = document.getElementById("reiniciar-demo");
    if (r) r.onclick = (e) => { e.preventDefault(); SkyMock.reiniciar(); location.href = "index.html"; };

    const t = document.createElement("div");
    t.id = "toasts";
    document.body.append(t);
  }

  // ---------------------------------------------------------------- toasts
  function toast(mensaje, tipo = "", ms = 4500) {
    const cont = document.getElementById("toasts");
    if (!cont) return alert(mensaje);
    const el = document.createElement("div");
    el.className = "toast " + tipo;
    el.innerHTML = mensaje;
    cont.append(el);
    setTimeout(() => el.remove(), ms);
  }

  // ---------------------------------------------------------------- sesión
  const CLAVE = "skycheck.sesion";
  const sesion = {
    get() { try { return JSON.parse(sessionStorage.getItem(CLAVE)); } catch { return null; } },
    set(id_ticket, correo) { sessionStorage.setItem(CLAVE, JSON.stringify({ id_ticket, correo })); },
    clear() { sessionStorage.removeItem(CLAVE); },
    requerir() {
      const s = sesion.get();
      if (!s) { location.href = "index.html?volver=" + encodeURIComponent(location.pathname.split("/").pop()); throw new Error("sin sesión"); }
      return s;
    },
  };

  // --------------------------------------------------------------- formatos
  function fecha(iso, conHora = true) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    const f = d.toLocaleDateString("es-CO", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
    return conHora ? `${f} · ${d.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", hour12: false })}` : f;
  }
  const hora = (iso) => iso ? new Date(iso).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", hour12: false }) : "—";
  const cop = (n) => "$" + Number(n || 0).toLocaleString("es-CO") + " COP";
  const kg = (n) => Number(n).toLocaleString("es-CO", { maximumFractionDigits: 1 }) + " kg";
  const ciudad = (iata) => CIUDADES[iata] || iata;

  function chip(estado) {
    const [txt, cls] = ESTADOS[estado] || [estado, ""];
    return `<span class="chip ${cls}">${esc(txt)}</span>`;
  }

  // Botón que muestra spinner mientras corre una promesa
  async function conCarga(boton, fn) {
    const html = boton.innerHTML;
    boton.disabled = true;
    boton.innerHTML = `<span class="spinner"></span> ${boton.dataset.cargando || "Procesando…"}`;
    try { return await fn(); }
    finally { boton.disabled = false; boton.innerHTML = html; }
  }

  // Muestra el error de la API en un toast (y lo devuelve por si se necesita)
  function error(e) {
    console.error(e);
    toast(esc(e.message || "Algo salió mal"), "bad");
    return e;
  }

  // ------------------------------------------------- pase de abordar (HTML)
  function barras(semilla) {
    let s = [...String(semilla)].reduce((a, c) => a + c.charCodeAt(0), 7);
    const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    let html = "";
    for (let i = 0; i < 38; i++) html += `<i style="width:${1 + Math.floor(rnd() * 3)}px;margin-right:${Math.floor(rnd() * 2)}px"></i>`;
    return `<div class="barras" aria-hidden="true">${html}</div>`;
  }

  function pase(t) {
    const maletas = (t.maletas || []).filter((m) => m.estado !== "cancelada").length;
    return `
      <article class="pase ${t.estado === "cancelado" ? "cancelado" : ""}">
        <div class="pase-main">
          <div class="pase-top">
            <span class="pase-aerolinea">${ICONOS.avion} ACES Airlines</span>
            ${chip(t.estado)}
          </div>
          <div class="pase-ruta">
            <div><div class="iata">${esc(t.origen)}</div><div class="ciudad">${esc(ciudad(t.origen))}</div></div>
            <div class="vuelo-linea">${ICONOS.avion}</div>
            <div><div class="iata">${esc(t.destino)}</div><div class="ciudad">${esc(ciudad(t.destino))}</div></div>
          </div>
          <div class="datos">
            <div class="dato"><small>Pasajero</small><b>${esc(t.nombre)}</b></div>
            <div class="dato"><small>Fecha</small><b>${esc(fecha(t.fecha_vuelo, false))}</b></div>
            <div class="dato"><small>Salida</small><b>${esc(hora(t.fecha_vuelo))}</b></div>
            <div class="dato"><small>Reserva</small><b class="mono">${esc(t.id_ticket)}</b></div>
            <div class="dato"><small>Maletas</small><b>${maletas}</b></div>
          </div>
        </div>
        <aside class="pase-talon">
          <div class="dato"><small>Vuelo</small><b>${esc(t.vuelo)}</b></div>
          <div class="dato"><small>Asiento</small><b>${esc(t.asiento)}</b></div>
          ${barras(t.id_ticket)}
        </aside>
      </article>`;
  }

  window.SkyUI = { ICONOS, esc, encabezado, toast, sesion, fecha, hora, cop, kg, ciudad, chip, conCarga, error, pase };
})();
