/*
 * reserva.js · Funcionalidad 6: Consultar estado de la reserva y del equipaje
 * Responsable: Mari (tiquetes)
 * API: GET /tickets/{id_ticket}?correo=   (ticket-lambda)
 */
SkyUI.encabezado("reserva");
const ses = SkyUI.sesion.requerir();
const app = document.getElementById("app");
const { esc, chip, kg, cop, fecha, ICONOS } = SkyUI;

function pasos(t) {
  const maletas = (t.maletas || []).filter((m) => m.estado !== "cancelada");
  const lista = [
    ["Reserva", true],
    ["Maletas", maletas.length > 0 || t.estado === "checkin"],
    ["Check-in", t.estado === "checkin"],
    ["Embarque", false],
  ];
  const actual = lista.findIndex(([, hecho]) => !hecho);
  return `<div class="pasos">${lista.map(([txt, hecho], i) =>
    `<div class="paso ${hecho ? "hecho" : i === actual ? "actual" : ""}">${txt}</div>`).join("")}</div>`;
}

function itemMaleta(m) {
  const ico = m.tipo === "cabina" ? ICONOS.mochila : ICONOS.maleta;
  const extra = m.cargo_exceso > 0 ? ` · exceso ${cop(m.cargo_exceso)}` : "";
  return `<div class="item">
    <div class="ico">${ico}</div>
    <div class="txt"><b>${m.tipo === "cabina" ? "Cabina" : "Bodega"} · ${kg(m.peso_kg)}</b>
      <span>${esc(m.descripcion || "Sin descripción")} · <span class="mono">${esc(m.id_maleta)}</span>${extra}</span></div>
    ${chip(m.estado)}
  </div>`;
}

function pintar(t) {
  const activa = t.estado === "reservado";
  const maletas = t.maletas || [];
  const btn = (href, txt, clase, habilitado, ico) =>
    `<a href="${href}" class="btn bloque ${clase} ${habilitado ? "" : "deshabilitado"}">${ico || ""} ${txt}</a>`;

  let aviso = "";
  if (t.estado === "cancelado")
    aviso = `<div class="alerta bad"><div><b>Reserva cancelada</b> el ${esc(fecha(t.cancelado_en))}. Ya no se pueden hacer cambios.</div></div>`;
  else if (t.estado === "checkin")
    aviso = `<div class="alerta ok"><div><b>¡Check-in listo!</b> Tu pasabordo está disponible y te lo enviamos al correo.</div></div>`;

  // Aviso que deja otra página antes de volver aquí (ej: modificar.html al guardar)
  const pendiente = sessionStorage.getItem("skycheck.aviso");
  if (pendiente) {
    sessionStorage.removeItem("skycheck.aviso");
    aviso = `<div class="alerta ok"><div>${pendiente}</div></div>` + aviso;
  }

  app.innerHTML = `
    <div class="encabezado">
      <h1>Hola, ${esc(t.nombre.split(" ")[0])} 👋</h1>
      <p class="muted">Este es el estado de tu reserva <b class="mono">${esc(t.id_ticket)}</b>.</p>
    </div>
    ${aviso}
    <div class="grid-2">
      <div>
        ${SkyUI.pase(t)}
        ${t.estado !== "cancelado" ? pasos(t) : ""}
        <div class="card" style="margin-top:1.5rem">
          <div class="card-titulo"><h2>Tus maletas</h2>
            <span class="muted small">${maletas.filter((m) => m.estado !== "cancelada").length} de 3</span></div>
          <div class="lista">${maletas.length ? maletas.map(itemMaleta).join("")
            : `<div class="vacio">Aún no has registrado maletas.</div>`}</div>
        </div>
      </div>

      <aside>
        <div class="card">
          <h2>¿Qué quieres hacer?</h2>
          <div class="lista" style="margin-top:1rem">
            ${btn("maletas.html", "Registrar maletas", "", activa, ICONOS.maleta)}
            ${t.estado === "checkin"
              ? btn("checkin.html", "Ver mi pasabordo", "coral", true, ICONOS.pase)
              : btn("checkin.html", "Hacer check-in", "coral", activa, ICONOS.pase)}
            ${btn("modificar.html", "Modificar reserva", "suave", activa, ICONOS.editar)}
            ${btn("cancelar.html", "Cancelar tiquete", "borde", t.estado !== "cancelado", ICONOS.x)}
          </div>
          ${!activa && t.estado !== "cancelado" ? `<p class="muted small" style="margin:1rem 0 0">Después del check-in ya no se pueden agregar maletas ni cambiar la reserva.</p>` : ""}
        </div>
        <div class="card">
          <h3>Datos de contacto</h3>
          <p class="small" style="margin:0">${esc(t.id_propietario)}<br>${esc(t.telefono || "Sin teléfono")}<br>
            <span class="muted">Documento ${esc(t.documento)}</span></p>
          <div class="acciones">
            <button class="btn chico borde" id="refrescar">Actualizar</button>
            <button class="btn chico borde" id="salir">Salir</button>
          </div>
        </div>
      </aside>
    </div>`;

  document.getElementById("salir").onclick = () => { SkyUI.sesion.clear(); location.href = "index.html"; };
  document.getElementById("refrescar").onclick = (e) => SkyUI.conCarga(e.currentTarget, cargar);
}

async function cargar() {
  try {
    const { ticket } = await SkyAPI.consultarReserva(ses.id_ticket, ses.correo);
    pintar(ticket);
  } catch (e) {
    if (e.status === 404) { SkyUI.sesion.clear(); location.href = "index.html"; return; }
    app.innerHTML = `<div class="alerta bad"><div><b>No pudimos cargar tu reserva.</b> ${esc(e.message)}</div></div>`;
  }
}
cargar();
