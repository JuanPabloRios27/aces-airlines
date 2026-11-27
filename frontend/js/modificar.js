/*
 * modificar.js · Funcionalidad 4: Modificar reserva (asiento y contacto)
 * Responsable: Mari (tiquetes)
 * API: GET /tickets/{id}  y  PUT /tickets/{id}   (ticket-lambda)
 *      -> el back encola un correo con el resumen de cambios (SQS + SES)
 */
SkyUI.encabezado("reserva");
const ses = SkyUI.sesion.requerir();
const app = document.getElementById("app");
const { esc } = SkyUI;

const FILAS = 30;
const LETRAS = ["A", "B", "C", "D", "E", "F"];
let ticket = null;
let elegido = null;

function mapaAsientos() {
  // Avión de lado: cada columna es una fila (1..30), de arriba a abajo F..A con pasillo
  let html = '<div class="cabina">';
  // columna de letras
  html += '<span></span>';
  ["F", "E", "D", "", "C", "B", "A"].forEach((l) => { html += l ? `<span class="letra">${l}</span>` : '<span class="pasillo"></span>'; });
  for (let f = 1; f <= FILAS; f++) {
    html += `<span class="num">${f}</span>`;
    ["F", "E", "D", "", "C", "B", "A"].forEach((l) => {
      if (!l) { html += '<span class="pasillo"></span>'; return; }
      const a = `${f}${l}`;
      const clases = ["asiento"];
      if (l === "A" || l === "F") clases.push("ventana");
      if (a === ticket.asiento) clases.push("actual");
      if (a === elegido) clases.push("elegido");
      html += `<button type="button" class="${clases.join(" ")}" data-a="${a}" title="Asiento ${a}">${l}</button>`;
    });
  }
  return html + "</div>";
}

function pintar() {
  const bloqueada = ticket.estado !== "reservado";
  app.innerHTML = `
    <div class="encabezado">
      <a class="volver" href="reserva.html">${SkyUI.ICONOS.flecha} Volver a mi reserva</a>
      <h1>Modificar reserva</h1>
      <p class="muted">Vuelo <b>${esc(ticket.vuelo)}</b> · ${esc(ticket.origen)} → ${esc(ticket.destino)} · ${esc(SkyUI.fecha(ticket.fecha_vuelo))}</p>
    </div>
    ${bloqueada ? `<div class="alerta warn"><div><b>Esta reserva ya no se puede modificar.</b> Los cambios solo se permiten antes del check-in.</div></div>` : ""}
    <form id="form" class="grid-2" novalidate>
      <div class="card">
        <div class="card-titulo"><h2>Elige tu asiento</h2>
          <span class="muted small">Actual: <b class="mono">${esc(ticket.asiento)}</b>
          ${elegido ? ` → <b class="mono" style="color:var(--coral)">${elegido}</b>` : ""}</span></div>
        <div class="avion" id="avion">${mapaAsientos()}</div>
        <div class="leyenda">
          <span><i class="actual"></i> Tu asiento actual</span>
          <span><i class="elegido"></i> Nuevo asiento</span>
          <span><i></i> Disponible*</span>
        </div>
        <p class="muted small" style="margin:.75rem 0 0">* Si el asiento ya está ocupado te avisamos al guardar. A y F son ventana; C y D, pasillo.</p>
      </div>
      <div>
        <div class="card">
          <h2>Datos de contacto</h2>
          <div class="campo"><label for="nombre">Nombre completo</label>
            <input id="nombre" value="${esc(ticket.nombre)}" maxlength="80"></div>
          <div class="campo"><label for="telefono">Teléfono</label>
            <input id="telefono" value="${esc(ticket.telefono || "")}" placeholder="+57 300 000 0000" maxlength="20"></div>
          <div class="campo"><label>Correo</label>
            <input value="${esc(ticket.id_propietario)}" disabled>
            <span class="ayuda">El correo identifica tu reserva y no se puede cambiar.</span></div>
          <button class="btn coral bloque" id="guardar" data-cargando="Guardando…" ${bloqueada ? "disabled" : ""}>Guardar cambios</button>
          <p class="muted small" style="margin:.75rem 0 0">Te enviaremos un correo con el resumen de los cambios.</p>
        </div>
      </div>
    </form>`;

  document.getElementById("avion").onclick = (e) => {
    const b = e.target.closest("button[data-a]");
    if (!b || bloqueada || b.dataset.a === ticket.asiento) return;
    elegido = elegido === b.dataset.a ? null : b.dataset.a;
    const scroll = document.getElementById("avion").scrollLeft;
    const nombre = document.getElementById("nombre").value, tel = document.getElementById("telefono").value;
    pintar();
    document.getElementById("avion").scrollLeft = scroll;
    document.getElementById("nombre").value = nombre;
    document.getElementById("telefono").value = tel;
  };
  document.getElementById("form").onsubmit = guardar;

  // Llevar el scroll del avión al asiento actual
  const actual = document.querySelector(".asiento.actual");
  if (actual && !elegido) document.getElementById("avion").scrollLeft = Math.max(0, actual.offsetLeft - 120);
}

async function guardar(e) {
  e.preventDefault();
  const datos = { correo: ses.correo };
  if (elegido) datos.asiento = elegido;
  const nombre = document.getElementById("nombre").value.trim();
  const tel = document.getElementById("telefono").value.trim();
  if (nombre && nombre !== ticket.nombre) datos.nombre = nombre;
  if (tel && tel !== (ticket.telefono || "")) datos.telefono = tel;
  if (Object.keys(datos).length === 1) return SkyUI.toast("No has cambiado nada todavía", "bad");

  try {
    const r = await SkyUI.conCarga(document.getElementById("guardar"), () => SkyAPI.modificarReserva(ses.id_ticket, datos));
    const nombres = { asiento: "Asiento", telefono: "Teléfono", nombre: "Nombre" };
    const lista = Object.entries(r.cambios).map(([k, v]) => `${nombres[k] || k}: <b>${esc(v)}</b>`).join(" · ");
    // Volver a "Mi reserva" y mostrar allá el aviso de que se guardó
    sessionStorage.setItem("skycheck.aviso", `<b>¡Cambios guardados!</b> ${lista}. Te enviamos un correo con el resumen.`);
    location.href = "reserva.html";
  } catch (err) {
    SkyUI.error(err);
  }
}

(async () => {
  try {
    ticket = (await SkyAPI.consultarReserva(ses.id_ticket, ses.correo)).ticket;
    pintar();
  } catch (e) {
    app.innerHTML = `<div class="alerta bad"><div>${esc(e.message)}</div></div>`;
  }
})();
