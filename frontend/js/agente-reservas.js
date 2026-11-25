/*
 * agente-reservas.js · Crear y listar reservas (para poder probar el sistema)
 * Responsable: Mari (tiquetes)
 * API: GET  /tickets    (ticket-lambda, con x-agent-key)
 *      POST /tickets    (ticket-lambda: crea la reserva y encola el correo de confirmación)
 */
const AgenteReservas = (() => {
  const { esc, chip } = SkyUI;
  let cont = null;

  async function pintar(el) {
    cont = el;
    cont.innerHTML = `<div class="cargando">Cargando reservas…</div>`;
    try {
      const { tickets } = await SkyAPI.listarReservas(Agente.clave());
      dibujar(tickets);
    } catch (e) {
      Agente.manejarError(e);
      cont.innerHTML = `<div class="alerta bad"><div>${esc(e.message)}</div></div>`;
    }
  }

  function dibujar(tickets) {
    const cuenta = (est) => tickets.filter((t) => t.estado === est).length;
    const manana = new Date(Date.now() + 86400000);
    const fechaDefecto = `${manana.toISOString().slice(0, 10)}T08:00`;

    cont.innerHTML = `
      <div class="kpis">
        <div class="kpi"><small>Reservas</small><b>${tickets.length}</b></div>
        <div class="kpi"><small>Reservadas</small><b>${cuenta("reservado")}</b></div>
        <div class="kpi"><small>Con check-in</small><b>${cuenta("checkin")}</b></div>
        <div class="kpi"><small>Canceladas</small><b>${cuenta("cancelado")}</b></div>
      </div>
      <div class="grid-2">
        <div class="card">
          <div class="card-titulo"><h2>Reservas</h2><button class="btn chico borde" id="refrescar">Actualizar</button></div>
          ${tickets.length ? `<div class="tabla-scroll"><table class="tabla">
            <thead><tr><th>Código</th><th>Pasajero</th><th>Vuelo</th><th>Asiento</th><th>Estado</th></tr></thead>
            <tbody>${tickets.map((t) => `<tr>
              <td><b class="mono">${esc(t.id_ticket)}</b></td>
              <td>${esc(t.nombre)}<br><span class="muted small">${esc(t.id_propietario)}</span></td>
              <td>${esc(t.vuelo)} ${esc(t.origen)}→${esc(t.destino)}<br><span class="muted small">${esc(SkyUI.fecha(t.fecha_vuelo))}</span></td>
              <td class="mono">${esc(t.asiento)}</td>
              <td>${chip(t.estado)}</td></tr>`).join("")}</tbody></table></div>`
            : `<div class="vacio">No hay reservas todavía. Crea la primera →</div>`}
        </div>

        <form class="card" id="nueva" novalidate>
          <h2>Nueva reserva</h2>
          <div class="campo"><label for="n-nombre">Nombre del pasajero</label><input id="n-nombre" required maxlength="80"></div>
          <div class="campo"><label for="n-correo">Correo</label><input id="n-correo" type="email" required>
            <span class="ayuda">Mientras SES esté en sandbox, el correo debe estar verificado en AWS.</span></div>
          <div class="fila">
            <div class="campo"><label for="n-doc">Documento</label><input id="n-doc" required maxlength="20"></div>
            <div class="campo"><label for="n-tel">Teléfono</label><input id="n-tel" maxlength="20" placeholder="+57…"></div>
          </div>
          <div class="fila">
            <div class="campo"><label for="n-vuelo">Vuelo</label><input id="n-vuelo" class="mayus" value="AC204" maxlength="8"></div>
            <div class="campo"><label for="n-asiento">Asiento</label><input id="n-asiento" class="mayus" value="${1 + Math.floor(Math.random() * 30)}${"ABCDEF"[Math.floor(Math.random() * 6)]}" maxlength="3"></div>
          </div>
          <div class="fila">
            <div class="campo"><label for="n-origen">Origen</label><input id="n-origen" class="mayus" value="BOG" maxlength="3"></div>
            <div class="campo"><label for="n-destino">Destino</label><input id="n-destino" class="mayus" value="MDE" maxlength="3"></div>
          </div>
          <div class="campo"><label for="n-fecha">Fecha y hora de salida</label><input id="n-fecha" type="datetime-local" value="${fechaDefecto}"></div>
          <button class="btn coral bloque" id="crear" data-cargando="Creando…">Crear reserva</button>
          <div id="creada"></div>
        </form>
      </div>`;

    document.getElementById("refrescar").onclick = () => pintar(cont);
    document.getElementById("nueva").onsubmit = crear;
  }

  async function crear(e) {
    e.preventDefault();
    const v = (id) => document.getElementById(id).value.trim();
    const datos = {
      nombre: v("n-nombre"), correo: v("n-correo"), documento: v("n-doc"), telefono: v("n-tel"),
      vuelo: v("n-vuelo"), asiento: v("n-asiento"), origen: v("n-origen"), destino: v("n-destino"),
      fecha_vuelo: v("n-fecha"),
    };
    try {
      const { ticket } = await SkyUI.conCarga(document.getElementById("crear"), () => SkyAPI.crearReserva(datos, Agente.clave()));
      SkyUI.toast(`Reserva <b class="mono">${esc(ticket.id_ticket)}</b> creada. Le llegará el código al correo.`, "ok", 8000);
      await pintar(cont);
      document.getElementById("creada").innerHTML = `
        <div class="alerta ok" style="margin:1rem 0 0"><div>Última creada: <b class="mono">${esc(ticket.id_ticket)}</b> · ${esc(ticket.id_propietario)}</div></div>`;
    } catch (err) {
      Agente.manejarError(err);
    }
  }

  return { pintar };
})();
