# Usa la imagen oficial de Playwright con Chromium y todas sus dependencias ya listas
FROM mcr.microsoft.com/playwright:v1.45.0-jammy

WORKDIR /app

# Copia los archivos de dependencias
COPY package*.json ./

# Instala las dependencias de Node
RUN npm install

# Copia el resto del código
COPY . .

# Expone el puerto por defecto de Render
EXPOSE 3000

ENV PORT=3000

# Inicia el servidor
CMD ["npm", "start"]