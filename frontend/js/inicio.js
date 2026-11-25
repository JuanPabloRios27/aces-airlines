// inicio.js · Página de inicio (base común)
SkyUI.encabezado("inicio");

const { ICONOS } = SkyUI;
const servicios = [
  [ICONOS.maleta, "Registra tus maletas", "Revisa el peso al instante y conoce el cargo por exceso antes de llegar."],
  [ICONOS.pase, "Check-in y pasabordo", "Haz check-in en línea y recibe tu pasabordo en PDF por correo."],
  [ICONOS.editar, "Modifica tu reserva", "Cambia tu asiento o tus datos de contacto antes del check-in."],
  [ICONOS.escudo, "Cancela con verificación", "Te enviamos un código al correo para confirmar que eres tú."],
];
document.getElementById("servicios").innerHTML = servicios.map(([ico, t, d]) =>
  `<div class="servicio"><div class="icono">${ico}</div><h3>${t}</h3><p>${d}</p></div>`).join("");

const form = document.getElementById("form-buscar");
const inpId = document.getElementById("id_ticket");
const inpCorreo = document.getElementById("correo");

// Si ya hay sesión, precargar
const s = SkyUI.sesion.get();
if (s) { inpId.value = s.id_ticket; inpCorreo.value = s.correo; }

if (SkyAPI.esDemo) {
  document.getElementById("demo-ayuda").classList.remove("hidden");
  document.getElementById("llenar-demo").onclick = (e) => {
    e.preventDefault();
    inpId.value = "SKY7Q2M4K";
    inpCorreo.value = "laura@demo.co";
  };
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = inpId.value.trim().toUpperCase();
  const correo = inpCorreo.value.trim().toLowerCase();
  if (!id || !correo) return SkyUI.toast("Escribe el código de reserva y tu correo", "bad");

  const boton = form.querySelector("button");
  try {
    await SkyUI.conCarga(boton, () => SkyAPI.consultarReserva(id, correo));
    SkyUI.sesion.set(id, correo);
    const volver = new URLSearchParams(location.search).get("volver");
    location.href = volver && /^[a-z]+\.html$/.test(volver) ? volver : "reserva.html";
  } catch (err) {
    SkyUI.error(err);
  }
});
