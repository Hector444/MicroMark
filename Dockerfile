# --- Fase 1: Builder ---
# Usamos una imagen completa de Node para instalar dependencias
FROM node:18-bullseye-slim AS builder
WORKDIR /usr/src/app

# Instalar dependencias del sistema operativo
RUN apt-get update && apt-get install -y --no-install-recommends git

COPY package*.json ./
RUN npm install --omit=dev

# --- Fase 2: Production ---
# Usamos la imagen slim de Debian (Bullseye) para la ejecución final
FROM node:18-bullseye-slim
WORKDIR /usr/src/app

# Instalar dependencias clave del sistema: FFMPEG y LibreOffice
# Esta versión de Debian tiene mejores fuentes y compatibilidad
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libreoffice \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Copiamos las dependencias ya instaladas desde la fase de builder
COPY --from=builder /usr/src/app/node_modules ./node_modules
# Copiamos el código de nuestra aplicación
COPY index.js ./

# Exponemos el puerto en el que correrá nuestro servicio
EXPOSE 3000

# Comando para iniciar el servicio
CMD [ "node", "index.js" ]