// api/verify-paypal-subscription.js
// Verifica una suscripción de PayPal contra la API real de PayPal antes de
// generar un código profesional. Nunca confía en datos enviados desde el navegador.

const PAYPAL_API_BASE = 'https://api-m.paypal.com'; // Live. Usar api-m.sandbox.paypal.com solo en pruebas.

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const { subscriptionID, nombre, email, especialidad } = req.body || {};

    if (!subscriptionID || !email) {
      return res.status(400).json({ error: 'Faltan datos: subscriptionID y email son obligatorios' });
    }

    const {
      PAYPAL_CLIENT_ID,
      PAYPAL_SECRET,
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY
    } = process.env;

    if (!PAYPAL_CLIENT_ID || !PAYPAL_SECRET || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      console.error('Faltan variables de entorno en Vercel');
      return res.status(500).json({ error: 'Configuración del servidor incompleta' });
    }

    // 1) Autenticarse con PayPal para obtener un access token
    const authResponse = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_SECRET}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'grant_type=client_credentials'
    });

    if (!authResponse.ok) {
      const errText = await authResponse.text();
      console.error('Error autenticando con PayPal:', errText);
      return res.status(502).json({ error: 'No se pudo autenticar con PayPal' });
    }

    const authData = await authResponse.json();
    const accessToken = authData.access_token;

    // 2) Consultar el estado real de la suscripción en PayPal
    const subResponse = await fetch(`${PAYPAL_API_BASE}/v1/billing/subscriptions/${subscriptionID}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!subResponse.ok) {
      const errText = await subResponse.text();
      console.error('Error consultando suscripción en PayPal:', errText);
      return res.status(502).json({ error: 'No se pudo verificar la suscripción en PayPal' });
    }

    const subData = await subResponse.json();

    // 3) Solo continuar si PayPal confirma que está ACTIVE
    if (subData.status !== 'ACTIVE') {
      return res.status(402).json({
        error: 'La suscripción no está activa',
        status: subData.status || 'desconocido'
      });
    }

    // 4) Generar un código profesional único, solo tras verificación exitosa
    const codigoProfesional = generarCodigoProfesional();

    // 5) Guardar el profesional en Supabase usando la service role key (bypasea RLS)
    const supabaseResponse = await fetch(`${SUPABASE_URL}/rest/v1/profesionales`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        codigo: codigoProfesional,
        nombre: nombre || '',
        email: email,
        especialidad: especialidad || '',
        rol: 'medico',
        paypal_subscription_id: subscriptionID,
        activo: true
      })
    });

    if (!supabaseResponse.ok) {
      const errText = await supabaseResponse.text();
      console.error('Error guardando en Supabase:', errText);
      return res.status(502).json({ error: 'La suscripción se verificó pero no se pudo guardar el registro' });
    }

    const supabaseData = await supabaseResponse.json();

    return res.status(200).json({
      success: true,
      codigo: codigoProfesional,
      profesional: supabaseData[0] || null
    });

  } catch (err) {
    console.error('Error inesperado en verify-paypal-subscription:', err);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
};

function generarCodigoProfesional() {
  const letras = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // sin I/O para evitar confusión
  const numeros = '0123456789';
  let codigo = 'MED';
  for (let i = 0; i < 3; i++) codigo += letras[Math.floor(Math.random() * letras.length)];
  codigo += '-';
  for (let i = 0; i < 4; i++) codigo += numeros[Math.floor(Math.random() * numeros.length)];
  return codigo;
}
