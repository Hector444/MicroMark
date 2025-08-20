# --- Fase 1: Builder ---
FROM node:18-bullseye-slim AS builder
WORKDIR /usr/src/app

# Instalar dependencias del sistema operativo
RUN apt-get update && apt-get install -y --no-install-recommends git

COPY package*.json ./
RUN npm install --omit=dev

# --- Fase 2: Production ---
FROM node:18-bullseye-slim
WORKDIR /usr/src/app

# Instalar dependencias clave y AÑADIR FUENTES DE MICROSOFT
RUN apt-get update && \
    # Habilitar los repositorios 'contrib' y 'non-free' editando el archivo principal
    sed -i 's/main/main contrib non-free/g' /etc/apt/sources.list && \
    apt-get update && \
    # Aceptar la licencia de las fuentes de MS de forma no interactiva
    echo "ttf-mscorefonts-installer msttcorefonts/accepted-mscorefonts-eula select true" | debconf-set-selections && \
    apt-get install -y --no-install-recommends \
    ffmpeg \
    libreoffice \
    ttf-mscorefonts-installer \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Copiamos las dependencias ya instaladas desde la fase de builder
COPY --from=builder /usr/src/app/node_modules ./node_modules
# Copiamos el código de nuestra aplicación
COPY index.js ./

# Exponemos el puerto en el que correrá nuestro servicio
EXPOSE 3000

# Comando para iniciar el servicio
CMD [ "node", "index.js" ]