const express = require('express');
const cors = require('cors');
const { chromium } = require('playwright');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.get('/api/get-session', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl || !targetUrl.startsWith('http')) {
    return res.status(400).json({ error: 'Falta el parámetro url o es inválido' });
  }

  // Tiempo máximo total a esperar en la fila (en milisegundos). Default: 5 minutos.
  const MAX_WAIT_MS = parseInt(req.query.maxWait || '300000', 10);
  const POLL_INTERVAL_MS = 3000;

  let browser = null;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 }
    });

    const page = await context.newPage();

    console.log(`[Queue-IT] Navegando hacia: ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    const startTime = Date.now();
    let acceptedCookie = null;
    let allCookies = [];

    // Bucle de espera activa: consulta las cookies periódicamente hasta que aparezca QueueITAccepted
    while (Date.now() - startTime < MAX_WAIT_MS) {
      allCookies = await context.cookies();

      // Busca específicamente la cookie que valida el pase de la fila
      acceptedCookie = allCookies.find(c => 
        c.name.startsWith('QueueITAccepted') ||
        (c.name.toLowerCase().includes('queueit') && c.value.includes('EventId'))
      );

      // Si ya la encontró o si la URL final ya no está en el dominio de queue-it
      const currentUrl = page.url();
      const leftQueueDomain = !currentUrl.includes('queue-it.net') && !currentUrl.includes('queueit');

      if (acceptedCookie) {
        console.log(`[Queue-IT] ¡Cookie conseguida tras ${(Date.now() - startTime) / 1000}s!`);
        break;
      }

      // Si ya salió de la fila pero la cookie tiene otro nombre, revisamos si volvió al sitio original
      if (leftQueueDomain && currentUrl.includes('bocasocios') && allCookies.length > 0) {
        console.log(`[Queue-IT] Redirigido fuera de Queue-it hacia: ${currentUrl}`);
        break;
      }

      // Espera antes de volver a verificar el estado
      await page.waitForTimeout(POLL_INTERVAL_MS);
    }

    await browser.close();

    if (!acceptedCookie) {
      return res.status(408).json({
        error: 'Tiempo de espera agotado en la fila virtual sin obtener QueueITAccepted',
        waitedSeconds: (Date.now() - startTime) / 1000,
        currentUrl: page.url(),
        availableCookies: allCookies.map(c => c.name)
      });
    }

    // Devuelve el formato esperado por el bot
    return res.json({
      success: true,
      name: acceptedCookie.name,
      value: acceptedCookie.value,
      decodedValue: decodeURIComponent(acceptedCookie.value),
      cookieHeader: `${acceptedCookie.name}=${acceptedCookie.value}`,
      fullCookieString: allCookies.map(c => `${c.name}=${c.value}`).join('; ')
    });

  } catch (error) {
    if (browser) await browser.close();
    console.error('[Error Queue-IT]', error);
    return res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Servidor activo en el puerto ${PORT}`);
});
