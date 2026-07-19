// api/onvo-webhook.js
// ONVO llama a esta URL cuando confirma un cobro real (primer pago o renovación).
// Este es el ÚNICO lugar donde se genera el código profesional y se guarda en Supabase.
// Nunca confiar en el navegador para esto -- el navegador solo espera (polling) a que
// este webhook termine de procesar.

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    // 1) Verificar que la solicitud viene realmente de ONVO
    const secretRecibido = req.headers['x-webhook-secret'];
    const { ONVO_WEBHOOK_SECRET, ONVO_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

    if (!ONVO_WEBHOOK_SECRET || !ONVO_SECRET_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      console.error('Faltan variables de entorno en Vercel (ONVO/Supabase)');
      return res.status(500).json({ error: 'Configuración del servidor incompleta' });
    }

    if (secretRecibido !== ONVO_WEBHOOK_SECRET) {
      console.error('Webhook con secret inválido, solicitud ignorada');
      return res.status(401).json({ error: 'No autorizado' });
    }

    const evento = req.body || {};
    const tipo = evento.type;

    // Solo nos interesa cuando un cobro (inicial o renovación) se confirma con éxito
    if (tipo !== 'subscription.renewal.succeeded') {
      // Respondemos 200 igual para que ONVO no reintente eventos que no usamos
      return res.status(200).json({ recibido: true, ignorado: tipo });
    }

    const datos = evento.data || {};
    // IMPORTANTE: en este evento, "data" es la FACTURA/renovación, no la suscripción.
    // El id real de la suscripción viene en data.subscriptionId (data.id es el id de la factura).
    // La metadata (nombre, correo, especialidad) se guardó en la SUSCRIPCIÓN al crearla,
    // no en la factura -- por eso hay que consultar la suscripción directamente en ONVO.
    const subscriptionId = datos.subscriptionId;

    if (!subscriptionId) {
      console.error('Webhook sin subscriptionId:', evento);
      return res.status(200).json({ recibido: true, error: 'Sin subscriptionId en el evento' });
    }

    const subResp = await fetch(`https://api.onvopay.com/v1/subscriptions/${encodeURIComponent(subscriptionId)}`, {
      headers: {
        'Authorization': `Bearer ${ONVO_SECRET_KEY}`
      }
    });
    const subData = await subResp.json();

    if (!subResp.ok) {
      console.error('No se pudo obtener la suscripción desde ONVO:', subData);
      return res.status(200).json({ recibido: true, error: 'No se pudo obtener la suscripción' });
    }

    const metadata = subData.metadata || {};
    const nombre = metadata.nombre || '';
    const correo = metadata.correo || '';
    const especialidad = metadata.especialidad || '';

    if (!correo) {
      console.error('Suscripción sin correo en metadata:', subData);
      return res.status(200).json({ recibido: true, error: 'Datos insuficientes en metadata de la suscripción' });
    }

    // 2) Idempotencia: si ya existe un profesional con este subscriptionId, no duplicar
    const yaExisteResp = await fetch(
      `${SUPABASE_URL}/rest/v1/profesionales?onvo_subscription_id=eq.${encodeURIComponent(subscriptionId)}&select=id,codigo`,
      {
        headers: {
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
        }
      }
    );
    const yaExiste = await yaExisteResp.json();

    if (Array.isArray(yaExiste) && yaExiste.length > 0) {
      // Ya procesado antes (renovación repetida o reintento de ONVO) -- no hacer nada más
      return res.status(200).json({ recibido: true, yaProcesado: true });
    }

    // 3) Generar código profesional y guardar SOLO ahora que el cobro está confirmado
    const codigoProfesional = generarCodigoProfesional();

    const guardarResp = await fetch(`${SUPABASE_URL}/rest/v1/profesionales`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        codigo: codigoProfesional,
        nombre,
        correo,
        especialidad,
        rol: 'medico',
        onvo_subscription_id: subscriptionId,
        activo: true
      })
    });

    if (!guardarResp.ok) {
      const errTxt = await guardarResp.text();
      console.error('Error guardando profesional en Supabase:', errTxt);
      return res.status(200).json({ recibido: true, error: 'No se pudo guardar en Supabase' });
    }

    return res.status(200).json({ recibido: true, codigo: codigoProfesional });

  } catch (err) {
    console.error('Error inesperado en onvo-webhook:', err);
    // Respondemos 200 para evitar reintentos infinitos por errores no recuperables;
    // el error ya quedó registrado en los logs de Vercel para revisión manual.
    return res.status(200).json({ recibido: true, error: 'Error interno' });
  }
};

function generarCodigoProfesional() {
  const letras = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const numeros = '0123456789';
  let codigo = 'MED';
  for (let i = 0; i < 3; i++) codigo += letras[Math.floor(Math.random() * letras.length)];
  codigo += '-';
  for (let i = 0; i < 4; i++) codigo += numeros[Math.floor(Math.random() * numeros.length)];
  return codigo;
}
