// api/onvo-check-status.js
// El navegador consulta este endpoint cada pocos segundos después de que el
// widget de ONVO reporta éxito, esperando a que el webhook (fuente de verdad)
// haya terminado de generar el código profesional en Supabase.

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const { subscriptionId } = req.query || {};

    if (!subscriptionId) {
      return res.status(400).json({ error: 'Falta subscriptionId' });
    }

    const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      console.error('Faltan variables de entorno de Supabase en Vercel');
      return res.status(500).json({ error: 'Configuración del servidor incompleta' });
    }

    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/profesionales?onvo_subscription_id=eq.${encodeURIComponent(subscriptionId)}&select=codigo,nombre,correo`,
      {
        headers: {
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
        }
      }
    );

    const filas = await resp.json();

    if (Array.isArray(filas) && filas.length > 0) {
      return res.status(200).json({ listo: true, codigo: filas[0].codigo, nombre: filas[0].nombre, correo: filas[0].correo });
    }

    return res.status(200).json({ listo: false });

  } catch (err) {
    console.error('Error inesperado en onvo-check-status:', err);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
};
