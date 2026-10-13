const express = require('express');
const cors = require('cors');
const { chromium } = require('playwright');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/get-session', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(400).json({ error: 'Falta el parámetro url' });
  }

  let browser = null;
  try {
    // Inicia Chromium en modo headless
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    });

    const page = await context.newPage();

    // Navega a la URL y espera a que resuelva redirecciones (Queue-it)
    await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 45000 });

    // Extrae todas las cookies del contexto del navegador
    const cookies = await context.cookies();

    // Busca la cookie de Queue-it o toma todas
    const queueCookie = cookies.find(c => 
      c.name.toLowerCase().includes('queueit') || 
      c.value.includes('EventId')
    );

    await browser.close();

    if (!queueCookie) {
      return res.status(404).json({ 
        error: 'No se detectó cookie de Queue-it', 
        allCookies: cookies 
      });
    }

    return res.json({
      name: queueCookie.name,
      value: queueCookie.value,
      decodedValue: decodeURIComponent(queueCookie.value),
      cookieHeader: `${queueCookie.name}=${queueCookie.value}`
    });

  } catch (error) {
    if (browser) await browser.close();
    return res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor activo en el puerto ${PORT}`);
});