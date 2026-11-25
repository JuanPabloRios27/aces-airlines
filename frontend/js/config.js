/*
 * Configuración LOCAL del front.
 *
 * Cuando abres los HTML desde tu PC (doble clic o Live Server) se usa este
 * archivo: no hay URLs, así que el front corre en MODO DEMO con datos falsos
 * (js/mock.js) guardados en el navegador.
 *
 * Desplegado en AWS, la lambda aces-index reemplaza este archivo por uno
 * generado con las URLs reales de maleta-api y tickets-api (mock: false).
 *
 * Si quieres probar desde tu PC contra el back real, pega aquí las URLs
 * que imprime `terraform apply` y pon mock: false.
 */
window.SKYCHECK_CONFIG = {
  maletaApi: "",
  ticketApi: "",
  mock: true,
};
